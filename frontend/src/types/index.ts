export type TaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'retry' | 'paused'
export type NodeType = 'scheduler' | 'worker'

export interface Task {
  id: string
  name: string
  status: TaskStatus
  node: string
  createdAt: number
  startedAt?: number
  completedAt?: number
  retries: number
  maxRetries: number
  duration?: number
  logs: string[]
}

export interface ClusterNode {
  id: string
  name: string
  type: NodeType
  status: 'online' | 'offline' | 'overloaded'
  cpu: number
  memory: number
  tasks: number
  uptime: number
}

export type MaintenanceWindowStatus = 'scheduled' | 'active' | 'completed' | 'cancelled'

export interface MaintenanceWindow {
  id: string
  nodeId: string
  nodeName: string
  reason: string
  startTime: number
  endTime: number
  status: MaintenanceWindowStatus
  affectedTaskIds: string[]
  createdAt: number
}

export interface MetricsSnapshot {
  time: number
  totalTasks: number
  runningTasks: number
  successRate: number
  avgLatency: number
  nodeCount: number
}
