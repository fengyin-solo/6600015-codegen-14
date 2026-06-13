import { create } from 'zustand'
import type { Task, ClusterNode, MetricsSnapshot, TaskStatus, MaintenanceWindow, MaintenanceWindowStatus } from '../types'

// Mock data generators
function mockNodes(): ClusterNode[] {
  return Array.from({ length: 5 }, (_, i) => ({
    id: `node-${i + 1}`,
    name: i === 0 ? 'scheduler-main' : `worker-${i}`,
    type: i === 0 ? 'scheduler' as const : 'worker' as const,
    status: Math.random() > 0.1 ? 'online' as const : 'overloaded' as const,
    cpu: 20 + Math.random() * 60,
    memory: 30 + Math.random() * 50,
    tasks: Math.floor(Math.random() * 8),
    uptime: 3600 + Math.floor(Math.random() * 86400),
  }))
}

function mockTasks(nodes: ClusterNode[]): Task[] {
  const names = ['data_sync', 'email_batch', 'report_gen', 'cache_warm', 'log_rotate', 'db_backup', 'index_rebuild', 'health_check']
  return Array.from({ length: 12 }, (_, i) => {
    const status: TaskStatus[] = ['pending', 'running', 'success', 'failed']
    const s = status[Math.floor(Math.random() * 4)]
    const node = nodes[Math.floor(Math.random() * nodes.length)]
    return {
      id: `task-${1000 + i}`,
      name: names[i % names.length],
      status: s,
      node: node.name,
      createdAt: Date.now() - Math.floor(Math.random() * 600000),
      startedAt: s !== 'pending' ? Date.now() - Math.floor(Math.random() * 300000) : undefined,
      completedAt: (s === 'success' || s === 'failed') ? Date.now() - Math.floor(Math.random() * 60000) : undefined,
      retries: s === 'failed' ? Math.floor(Math.random() * 3) : 0,
      maxRetries: 3,
      duration: s === 'success' ? 1000 + Math.floor(Math.random() * 30000) : undefined,
      logs: [`[INFO] Task ${names[i % names.length]} started`, `[INFO] Processing on ${node.name}`],
    }
  })
}

const initialNodes = mockNodes()

interface TaskStore {
  tasks: Task[]
  nodes: ClusterNode[]
  metrics: MetricsSnapshot[]
  selectedTask: Task | null
  maintenanceWindows: MaintenanceWindow[]
  addTask: (name: string) => void
  retryTask: (id: string) => void
  cancelTask: (id: string) => void
  selectTask: (t: Task | null) => void
  refreshNodes: () => void
  addMetric: () => void
  createMaintenanceWindow: (nodeId: string, nodeName: string, reason: string, startTime: number, endTime: number) => void
  cancelMaintenanceWindow: (id: string) => void
  completeMaintenanceWindow: (id: string) => void
  isNodeInMaintenance: (nodeName: string) => boolean
  tickMaintenanceWindows: () => void
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: mockTasks(initialNodes),
  nodes: initialNodes,
  metrics: Array.from({ length: 20 }, (_, i) => ({
    time: Date.now() - (20 - i) * 5000,
    totalTasks: 100 + i * 2,
    runningTasks: 3 + Math.floor(Math.random() * 5),
    successRate: 85 + Math.random() * 14,
    avgLatency: 500 + Math.random() * 2000,
    nodeCount: 5,
  })),
  selectedTask: null,
  maintenanceWindows: [],
  addTask: (name) => {
    const state = get()
    const allNodes = state.nodes
    const availableNodes = allNodes.filter(n => !state.isNodeInMaintenance(n.name))
    const targetNodes = availableNodes.length > 0 ? availableNodes : allNodes
    const task: Task = {
      id: `task-${Date.now()}`,
      name, status: 'pending',
      node: targetNodes[Math.floor(Math.random() * targetNodes.length)].name,
      createdAt: Date.now(), retries: 0, maxRetries: 3, logs: [`[INFO] Task ${name} queued`],
    }
    if (availableNodes.length === 0 && allNodes.length > 0) {
      task.logs.push(`[WARN] All nodes in maintenance, task queued but scheduling paused`)
    }
    set({ tasks: [task, ...get().tasks] })
  },
  retryTask: (id) => set({
    tasks: get().tasks.map(t => t.id === id ? { ...t, status: 'pending', retries: t.retries + 1, logs: [...t.logs, '[INFO] Retrying...'] } : t)
  }),
  cancelTask: (id) => set({
    tasks: get().tasks.map(t => t.id === id ? { ...t, status: 'failed' as TaskStatus, logs: [...t.logs, '[WARN] Cancelled by user'] } : t)
  }),
  selectTask: (t) => set({ selectedTask: t }),
  refreshNodes: () => set({ nodes: mockNodes() }),
  addMetric: () => {
    const m: MetricsSnapshot = {
      time: Date.now(),
      totalTasks: get().tasks.length,
      runningTasks: get().tasks.filter(t => t.status === 'running').length,
      successRate: (get().tasks.filter(t => t.status === 'success').length / Math.max(get().tasks.length, 1)) * 100,
      avgLatency: 500 + Math.random() * 2000,
      nodeCount: get().nodes.filter(n => n.status !== 'offline').length,
    }
    set({ metrics: [...get().metrics.slice(-30), m] })
  },
  createMaintenanceWindow: (nodeId, nodeName, reason, startTime, endTime) => {
    const now = Date.now()
    const status: MaintenanceWindowStatus = now >= startTime ? 'active' : 'scheduled'
    const affectedTaskIds = get().tasks
      .filter(t => t.node === nodeName && (t.status === 'pending' || t.status === 'running'))
      .map(t => t.id)
    const mw: MaintenanceWindow = {
      id: `mw-${Date.now()}`,
      nodeId,
      nodeName,
      reason,
      startTime,
      endTime,
      status,
      affectedTaskIds,
      createdAt: now,
    }
    let tasks = get().tasks
    if (status === 'active') {
      tasks = tasks.map(t => {
        if (t.node === nodeName && (t.status === 'pending' || t.status === 'running')) {
          return {
            ...t,
            status: 'paused' as TaskStatus,
            logs: [...t.logs, `[WARN] Task paused: node ${nodeName} entered maintenance (${reason})`],
          }
        }
        return t
      })
    }
    set({ maintenanceWindows: [mw, ...get().maintenanceWindows], tasks })
  },
  cancelMaintenanceWindow: (id) => {
    const mw = get().maintenanceWindows.find(w => w.id === id)
    if (!mw) return
    const windows = get().maintenanceWindows.map(w =>
      w.id === id ? { ...w, status: 'cancelled' as MaintenanceWindowStatus } : w
    )
    let tasks = get().tasks
    const otherActiveMW = get().maintenanceWindows.filter(w => w.id !== id && w.status === 'active')
    tasks = tasks.map(t => {
      if (t.status !== 'paused' || t.node !== mw.nodeName) return t
      const stillPaused = otherActiveMW.some(w => w.nodeName === mw.nodeName)
      if (stillPaused) return t
      return {
        ...t,
        status: 'pending' as TaskStatus,
        logs: [...t.logs, `[INFO] Task resumed: maintenance window on ${mw.nodeName} cancelled`],
      }
    })
    set({ maintenanceWindows: windows, tasks })
  },
  completeMaintenanceWindow: (id) => {
    const mw = get().maintenanceWindows.find(w => w.id === id)
    if (!mw) return
    const windows = get().maintenanceWindows.map(w =>
      w.id === id ? { ...w, status: 'completed' as MaintenanceWindowStatus } : w
    )
    let tasks = get().tasks
    const otherActiveMW = get().maintenanceWindows.filter(w => w.id !== id && w.status === 'active')
    tasks = tasks.map(t => {
      if (t.status !== 'paused' || t.node !== mw.nodeName) return t
      const stillPaused = otherActiveMW.some(w => w.nodeName === mw.nodeName)
      if (stillPaused) return t
      return {
        ...t,
        status: 'pending' as TaskStatus,
        logs: [...t.logs, `[INFO] Task resumed: maintenance window on ${mw.nodeName} completed`],
      }
    })
    set({ maintenanceWindows: windows, tasks })
  },
  isNodeInMaintenance: (nodeName) => {
    return get().maintenanceWindows.some(w => w.nodeName === nodeName && w.status === 'active')
  },
  tickMaintenanceWindows: () => {
    const now = Date.now()
    let windows = get().maintenanceWindows
    let tasks = get().tasks
    let changed = false
    windows = windows.map(w => {
      if (w.status === 'scheduled' && now >= w.startTime && now < w.endTime) {
        changed = true
        const affectedTaskIds = tasks
          .filter(t => t.node === w.nodeName && (t.status === 'pending' || t.status === 'running'))
          .map(t => t.id)
        tasks = tasks.map(t => {
          if (t.node === w.nodeName && (t.status === 'pending' || t.status === 'running')) {
            return {
              ...t,
              status: 'paused' as TaskStatus,
              logs: [...t.logs, `[WARN] Task paused: node ${w.nodeName} entered maintenance (${w.reason})`],
            }
          }
          return t
        })
        return { ...w, status: 'active' as MaintenanceWindowStatus, affectedTaskIds }
      }
      if (w.status === 'active' && now >= w.endTime) {
        changed = true
        const otherActiveMW = windows.filter(ow => ow.id !== w.id && ow.status === 'active' && ow.nodeName === w.nodeName)
        tasks = tasks.map(t => {
          if (t.status !== 'paused' || t.node !== w.nodeName) return t
          const stillPaused = otherActiveMW.some(ow => ow.nodeName === w.nodeName)
          if (stillPaused) return t
          return {
            ...t,
            status: 'pending' as TaskStatus,
            logs: [...t.logs, `[INFO] Task resumed: maintenance window on ${w.nodeName} completed`],
          }
        })
        return { ...w, status: 'completed' as MaintenanceWindowStatus }
      }
      return w
    })
    if (changed) {
      set({ maintenanceWindows: windows, tasks })
    }
  },
}))
