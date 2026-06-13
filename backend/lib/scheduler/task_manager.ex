defmodule Scheduler.TaskManager do
  use GenServer

  defmodule Task do
    defstruct [:id, :name, :status, :node, :created_at, :retries, :max_retries, :logs]
  end

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, %{}, name: __MODULE__)
  end

  def list_tasks, do: GenServer.call(__MODULE__, :list_tasks)

  def add_task(name) do
    GenServer.call(__MODULE__, {:add_task, name})
  end

  def retry_task(id), do: GenServer.call(__MODULE__, {:retry_task, id})

  def cancel_task(id), do: GenServer.call(__MODULE__, {:cancel_task, id})

  def pause_task(id, reason), do: GenServer.call(__MODULE__, {:pause_task, id, reason})

  def resume_task(id, reason), do: GenServer.call(__MODULE__, {:resume_task, id, reason})

  def get_stats, do: GenServer.call(__MODULE__, :get_stats)

  @impl true
  def init(_) do
    tasks = for i <- 1..8 do
      name = Enum.at(~w[data_sync email_batch report_gen cache_warm log_rotate db_backup index_rebuild health_check], rem(i - 1, 8))
      status = Enum.at(~w[pending running success failed]a, :rand.uniform(4) - 1)
      %Task{
        id: "task-#{1000 + i}",
        name: name,
        status: status,
        node: "worker-#{:rand.uniform(4)}",
        created_at: DateTime.utc_now(),
        retries: 0,
        max_retries: 3,
        logs: ["[INFO] Task #{name} created"]
      }
    end
    {:ok, %{tasks: tasks, counter: 1009}}
  end

  @impl true
  def handle_call(:list_tasks, _from, state) do
    {:reply, state.tasks, state}
  end

  @impl true
  def handle_call({:add_task, name}, _from, state) do
    counter = state.counter + 1
    node = "worker-#{:rand.uniform(4)}"
    in_maintenance = Scheduler.MaintenanceManager.node_in_maintenance?(node)

    initial_status = if in_maintenance, do: :paused, else: :pending
    initial_logs = if in_maintenance do
      ["[INFO] Task #{name} queued", "[WARN] Task paused: node #{node} is under maintenance"]
    else
      ["[INFO] Task #{name} queued"]
    end

    task = %Task{
      id: "task-#{counter}",
      name: name,
      status: initial_status,
      node: node,
      created_at: DateTime.utc_now(),
      retries: 0,
      max_retries: 3,
      logs: initial_logs
    }
    {:reply, task, %{state | tasks: [task | state.tasks], counter: counter}}
  end

  @impl true
  def handle_call({:retry_task, id}, _from, state) do
    tasks = Enum.map(state.tasks, fn
      %{id: ^id} = t -> %{t | status: :pending, retries: t.retries + 1, logs: t.logs ++ ["[INFO] Retrying..."]}
      t -> t
    end)
    {:reply, :ok, %{state | tasks: tasks}}
  end

  @impl true
  def handle_call({:cancel_task, id}, _from, state) do
    tasks = Enum.map(state.tasks, fn
      %{id: ^id} = t -> %{t | status: :failed, logs: t.logs ++ ["[WARN] Cancelled"]}
      t -> t
    end)
    {:reply, :ok, %{state | tasks: tasks}}
  end

  @impl true
  def handle_call({:pause_task, id, reason}, _from, state) do
    tasks = Enum.map(state.tasks, fn
      %{id: ^id, status: s} = t when s in [:pending, :running] ->
        %{t | status: :paused, logs: t.logs ++ ["[WARN] Task paused: #{reason}"]}
      t -> t
    end)
    {:reply, :ok, %{state | tasks: tasks}}
  end

  @impl true
  def handle_call({:resume_task, id, reason}, _from, state) do
    tasks = Enum.map(state.tasks, fn
      %{id: ^id, status: :paused} = t ->
        %{t | status: :pending, logs: t.logs ++ ["[INFO] Task resumed: #{reason}"]}
      t -> t
    end)
    {:reply, :ok, %{state | tasks: tasks}}
  end

  @impl true
  def handle_call(:get_stats, _from, state) do
    stats = %{
      total: length(state.tasks),
      running: Enum.count(state.tasks, & &1.status == :running),
      success: Enum.count(state.tasks, & &1.status == :success),
      failed: Enum.count(state.tasks, & &1.status == :failed),
      paused: Enum.count(state.tasks, & &1.status == :paused)
    }
    {:reply, stats, state}
  end
end
