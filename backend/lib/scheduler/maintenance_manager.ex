defmodule Scheduler.MaintenanceManager do
  use GenServer

  defmodule Window do
    defstruct [:id, :node_name, :reason, :start_time, :end_time, :status, :affected_task_ids, :created_at]
  end

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, %{}, name: __MODULE__)
  end

  def create_window(node_name, reason, start_time, end_time) do
    GenServer.call(__MODULE__, {:create_window, node_name, reason, start_time, end_time})
  end

  def cancel_window(id) do
    GenServer.call(__MODULE__, {:cancel_window, id})
  end

  def complete_window(id) do
    GenServer.call(__MODULE__, {:complete_window, id})
  end

  def list_windows do
    GenServer.call(__MODULE__, :list_windows)
  end

  def node_in_maintenance?(node_name) do
    GenServer.call(__MODULE__, {:node_in_maintenance?, node_name})
  end

  def tick do
    GenServer.call(__MODULE__, :tick)
  end

  @impl true
  def init(_) do
    schedule_tick()
    {:ok, %{windows: [], counter: 0}}
  end

  defp schedule_tick do
    Process.send_after(self(), :tick_msg, 5_000)
  end

  @impl true
  def handle_info(:tick_msg, state) do
    new_state = do_tick(state)
    schedule_tick()
    {:noreply, new_state}
  end

  @impl true
  def handle_call(:list_windows, _from, state) do
    {:reply, state.windows, state}
  end

  @impl true
  def handle_call({:create_window, node_name, reason, start_time, end_time}, _from, state) do
    now = DateTime.utc_now() |> DateTime.to_unix(:millisecond)
    status = if now >= start_time, do: :active, else: :scheduled

    counter = state.counter + 1
    window = %Window{
      id: "mw-#{counter}",
      node_name: node_name,
      reason: reason,
      start_time: start_time,
      end_time: end_time,
      status: status,
      affected_task_ids: [],
      created_at: now
    }

    new_state = if status == :active do
      pause_affected_tasks(state, window)
    else
      %{state | windows: [window | state.windows], counter: counter}
    end

    {:reply, window, new_state}
  end

  @impl true
  def handle_call({:cancel_window, id}, _from, state) do
    window = Enum.find(state.windows, &(&1.id == id))
    if window == nil do
      {:reply, {:error, :not_found}, state}
    else
      windows = Enum.map(state.windows, fn
        %{id: ^id} = w -> %{w | status: :cancelled}
        w -> w
      end)
      new_state = resume_tasks_if_no_other_maintenance(%{state | windows: windows}, window.node_name)
      {:reply, :ok, new_state}
    end
  end

  @impl true
  def handle_call({:complete_window, id}, _from, state) do
    window = Enum.find(state.windows, &(&1.id == id))
    if window == nil do
      {:reply, {:error, :not_found}, state}
    else
      windows = Enum.map(state.windows, fn
        %{id: ^id} = w -> %{w | status: :completed}
        w -> w
      end)
      new_state = resume_tasks_if_no_other_maintenance(%{state | windows: windows}, window.node_name)
      {:reply, :ok, new_state}
    end
  end

  @impl true
  def handle_call({:node_in_maintenance?, node_name}, _from, state) do
    in_maintenance = Enum.any?(state.windows, fn w ->
      w.node_name == node_name and w.status == :active
    end)
    {:reply, in_maintenance, state}
  end

  @impl true
  def handle_call(:tick, _from, state) do
    new_state = do_tick(state)
    {:reply, :ok, new_state}
  end

  defp do_tick(state) do
    now = DateTime.utc_now() |> DateTime.to_unix(:millisecond)

    Enum.reduce(state.windows, state, fn window, acc ->
      case window.status do
        :scheduled when now >= window.start_time and now < window.end_time ->
          pause_affected_tasks(acc, %{window | status: :active})

        :active when now >= window.end_time ->
          new_windows = Enum.map(acc.windows, fn
            %{id: ^window.id} = w -> %{w | status: :completed}
            w -> w
          end)
          resume_tasks_if_no_other_maintenance(%{acc | windows: new_windows}, window.node_name)

        _ ->
          acc
      end
    end)
  end

  defp pause_affected_tasks(state, window) do
    tasks = Scheduler.TaskManager.list_tasks()
    affected = Enum.filter(tasks, fn t ->
      t.node == window.node_name and t.status in [:pending, :running]
    end)
    affected_ids = Enum.map(affected, & &1.id)

    Enum.each(affected, fn t ->
      Scheduler.TaskManager.pause_task(t.id, "Node #{window.node_name} entered maintenance: #{window.reason}")
    end)

    windows = Enum.map(state.windows, fn
      %{id: ^window.id} = w -> %{w | status: :active, affected_task_ids: affected_ids}
      w -> w
    end)

    if Enum.any?(state.windows, &(&1.id == window.id)) do
      %{state | windows: windows}
    else
      counter = state.counter + 1
      %{state | windows: [%{window | affected_task_ids: affected_ids} | state.windows], counter: counter}
    end
  end

  defp resume_tasks_if_no_other_maintenance(state, node_name) do
    other_active = Enum.any?(state.windows, fn w ->
      w.node_name == node_name and w.status == :active
    end)

    unless other_active do
      tasks = Scheduler.TaskManager.list_tasks()
      paused = Enum.filter(tasks, fn t ->
        t.node == node_name and t.status == :paused
      end)
      Enum.each(paused, fn t ->
        Scheduler.TaskManager.resume_task(t.id, "Maintenance window on #{node_name} ended")
      end)
    end

    state
  end
end
