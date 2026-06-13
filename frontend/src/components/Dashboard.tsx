import { useState, useMemo } from 'react'
import { Layout, Tabs, Statistic, Row, Col, Card, Tag, Button, Input, Table, Drawer, Descriptions, Space, Progress, Modal, Select, DatePicker, Form, message } from 'antd'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts'
import { useTaskStore } from '../store/tasks'
import type { Task, TaskStatus, MaintenanceWindow, MaintenanceWindowStatus } from '../types'
import dayjs, { Dayjs } from 'dayjs'

const { Header, Content } = Layout
const { RangePicker } = DatePicker

const STATUS_COLORS: Record<TaskStatus, string> = {
  pending: 'default', running: 'processing', success: 'success', failed: 'error', retry: 'warning', paused: 'purple'
}

const MW_STATUS_COLORS: Record<MaintenanceWindowStatus, string> = {
  scheduled: 'blue', active: 'orange', completed: 'green', cancelled: 'default'
}

const MW_STATUS_LABELS: Record<MaintenanceWindowStatus, string> = {
  scheduled: '计划中', active: '维护中', completed: '已完成', cancelled: '已取消'
}

export default function Dashboard() {
  const store = useTaskStore()
  const [newTaskName, setNewTaskName] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [mwModalOpen, setMwModalOpen] = useState(false)
  const [mwForm] = Form.useForm()

  const nodeOptions = useMemo(() => {
    return store.nodes.map(n => ({
      label: (
        <Space>
          <span>{n.name}</span>
          {store.isNodeInMaintenance(n.name) && <Tag color="orange">维护中</Tag>}
        </Space>
      ),
      value: n.id,
      disabled: store.isNodeInMaintenance(n.name),
      nodeName: n.name,
    }))
  }, [store.nodes, store.maintenanceWindows])

  const disabledDate = (current: Dayjs | null) => {
    if (!current) return false
    return current.isBefore(dayjs().startOf('day'))
  }

  const handleOpenMWModal = () => {
    store.setUiPaused(true)
    mwForm.resetFields()
    mwForm.setFieldsValue({
      timeRange: [dayjs().add(1, 'hour'), dayjs().add(3, 'hour')],
    })
    setMwModalOpen(true)
  }

  const handleCloseMWModal = () => {
    mwForm.resetFields()
    setMwModalOpen(false)
    store.setUiPaused(false)
  }

  const handleCreateMW = () => {
    mwForm.validateFields()
      .then(values => {
        const [start, end] = values.timeRange as [Dayjs, Dayjs]
        if (!start || !end) {
          message.error('请选择维护时间范围')
          return
        }
        if (end.isBefore(start) || end.isSame(start)) {
          message.error('结束时间必须晚于开始时间')
          return
        }
        const selectedOption = nodeOptions.find(o => o.value === values.nodeId)
        if (!selectedOption) {
          message.error('请选择有效的节点')
          return
        }
        store.createMaintenanceWindow(
          values.nodeId,
          selectedOption.nodeName,
          values.reason,
          start.valueOf(),
          end.valueOf(),
        )
        message.success('维护窗口创建成功')
        handleCloseMWModal()
      })
      .catch(err => {
        console.error('Form validation failed:', err)
        message.error('请填写完整的维护窗口信息')
      })
  }

  const taskColumns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 100 },
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '状态', dataIndex: 'status', key: 'status', render: (s: TaskStatus) => <Tag color={STATUS_COLORS[s]}>{s === 'paused' ? '已暂停' : s}</Tag> },
    { title: '节点', dataIndex: 'node', key: 'node', render: (node: string) => (
      <Space>
        {node}
        {store.isNodeInMaintenance(node) && <Tag color="orange">维护中</Tag>}
      </Space>
    )},
    { title: '重试', key: 'retries', render: (_: any, r: Task) => `${r.retries}/${r.maxRetries}` },
    { title: '耗时', key: 'duration', render: (_: any, r: Task) => r.duration ? `${(r.duration / 1000).toFixed(1)}s` : '-' },
    { title: '操作', key: 'actions', render: (_: any, r: Task) => (
      <Space>
        {r.status === 'failed' && <Button size="small" type="primary" onClick={() => store.retryTask(r.id)}>重试</Button>}
        {r.status === 'running' && <Button size="small" danger onClick={() => store.cancelTask(r.id)}>取消</Button>}
        <Button size="small" onClick={() => { store.selectTask(r); setDrawerOpen(true) }}>详情</Button>
      </Space>
    )},
  ]

  const mwColumns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 120 },
    { title: '节点', dataIndex: 'nodeName', key: 'nodeName', render: (name: string) => (
      <Space>
        <span>{name}</span>
        {store.isNodeInMaintenance(name) && <Tag color="orange">维护中</Tag>}
      </Space>
    )},
    { title: '原因', dataIndex: 'reason', key: 'reason' },
    { title: '状态', dataIndex: 'status', key: 'status', render: (s: MaintenanceWindowStatus) => (
      <Tag color={MW_STATUS_COLORS[s]}>{MW_STATUS_LABELS[s]}</Tag>
    )},
    { title: '开始时间', key: 'startTime', render: (_: any, r: MaintenanceWindow) => new Date(r.startTime).toLocaleString() },
    { title: '结束时间', key: 'endTime', render: (_: any, r: MaintenanceWindow) => new Date(r.endTime).toLocaleString() },
    { title: '受影响任务', key: 'affected', render: (_: any, r: MaintenanceWindow) => <Tag>{r.affectedTaskIds.length} 个任务</Tag> },
    { title: '操作', key: 'actions', render: (_: any, r: MaintenanceWindow) => (
      <Space>
        {r.status === 'scheduled' && <Button size="small" danger onClick={() => store.cancelMaintenanceWindow(r.id)}>取消</Button>}
        {r.status === 'active' && <Button size="small" type="primary" onClick={() => store.completeMaintenanceWindow(r.id)}>提前结束</Button>}
      </Space>
    )},
  ]

  const successCount = store.tasks.filter(t => t.status === 'success').length
  const failedCount = store.tasks.filter(t => t.status === 'failed').length
  const runningCount = store.tasks.filter(t => t.status === 'running').length
  const pausedCount = store.tasks.filter(t => t.status === 'paused').length

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <h1 style={{ color: 'white', margin: 0, fontSize: 18 }}>🔧 分布式任务调度与监控平台</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Input placeholder="任务名称" value={newTaskName} onChange={e => setNewTaskName(e.target.value)} style={{ width: 160 }} />
          <Button type="primary" onClick={() => { if (newTaskName) { store.addTask(newTaskName); setNewTaskName('') } }}>
            添加任务
          </Button>
        </div>
      </Header>
      <Content style={{ padding: 16 }}>
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={5}><Card><Statistic title="总任务" value={store.tasks.length} /></Card></Col>
          <Col span={5}><Card><Statistic title="运行中" value={runningCount} valueStyle={{ color: '#1890ff' }} /></Card></Col>
          <Col span={5}><Card><Statistic title="成功" value={successCount} valueStyle={{ color: '#52c41a' }} /></Card></Col>
          <Col span={5}><Card><Statistic title="失败" value={failedCount} valueStyle={{ color: '#ff4d4f' }} /></Card></Col>
          <Col span={4}><Card><Statistic title="已暂停" value={pausedCount} valueStyle={{ color: '#722ed1' }} /></Card></Col>
        </Row>

        <Tabs items={[
          { key: 'metrics', label: '监控指标', children: (
            <Row gutter={16}>
              <Col span={12}>
                <Card title="运行中任务数">
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={store.metrics}>
                      <XAxis dataKey="time" tickFormatter={t => new Date(t).toLocaleTimeString()} fontSize={10} />
                      <YAxis fontSize={10} />
                      <Tooltip labelFormatter={t => new Date(t as number).toLocaleString()} />
                      <Area type="monotone" dataKey="runningTasks" stroke="#1890ff" fill="#1890ff" fillOpacity={0.3} />
                    </AreaChart>
                  </ResponsiveContainer>
                </Card>
              </Col>
              <Col span={12}>
                <Card title="成功率 %">
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={store.metrics}>
                      <XAxis dataKey="time" tickFormatter={t => new Date(t).toLocaleTimeString()} fontSize={10} />
                      <YAxis domain={[0, 100]} fontSize={10} />
                      <Tooltip labelFormatter={t => new Date(t as number).toLocaleString()} />
                      <Line type="monotone" dataKey="successRate" stroke="#52c41a" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </Card>
              </Col>
              <Col span={24} style={{ marginTop: 16 }}>
                <Card title="平均延迟 (ms)">
                  <ResponsiveContainer width="100%" height={150}>
                    <AreaChart data={store.metrics}>
                      <XAxis dataKey="time" tickFormatter={t => new Date(t).toLocaleTimeString()} fontSize={10} />
                      <YAxis fontSize={10} />
                      <Tooltip />
                      <Area type="monotone" dataKey="avgLatency" stroke="#faad14" fill="#faad14" fillOpacity={0.2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </Card>
              </Col>
            </Row>
          )},
          { key: 'tasks', label: '任务列表', children: (
            <Table dataSource={store.tasks} columns={taskColumns} rowKey="id" size="small" pagination={{ pageSize: 10 }} />
          )},
          { key: 'nodes', label: '集群节点', children: (
            <Row gutter={16}>
              {store.nodes.map(node => (
                <Col span={8} key={node.id} style={{ marginBottom: 16 }}>
                  <Card title={<span>{node.type === 'scheduler' ? '🎯' : '⚙️'} {node.name}</span>}
                    extra={
                      <Space>
                        {store.isNodeInMaintenance(node.name) && <Tag color="orange">维护中</Tag>}
                        <Tag color={node.status === 'online' ? 'green' : node.status === 'overloaded' ? 'orange' : 'red'}>{node.status}</Tag>
                      </Space>
                    }>
                    <Progress percent={Math.round(node.cpu)} strokeColor={node.cpu > 80 ? '#ff4d4f' : '#1890ff'} format={v => `CPU ${v}%`} />
                    <Progress percent={Math.round(node.memory)} strokeColor={node.memory > 80 ? '#ff4d4f' : '#52c41a'} format={v => `MEM ${v}%`} />
                    <div style={{ marginTop: 8, fontSize: 12, color: '#888' }}>
                      任务数: {node.tasks} | 运行时间: {Math.floor(node.uptime / 3600)}h
                    </div>
                  </Card>
                </Col>
              ))}
            </Row>
          )},
          { key: 'maintenance', label: '维护窗口', children: (
            <div>
              <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Space>
                  <Tag color="orange">活跃维护: {store.maintenanceWindows.filter(w => w.status === 'active').length}</Tag>
                  <Tag color="blue">计划中: {store.maintenanceWindows.filter(w => w.status === 'scheduled').length}</Tag>
                  <Tag color="green">已完成: {store.maintenanceWindows.filter(w => w.status === 'completed').length}</Tag>
                </Space>
                <Button type="primary" onClick={handleOpenMWModal}>新建维护窗口</Button>
              </div>
              <Table dataSource={store.maintenanceWindows} columns={mwColumns} rowKey="id" size="small" pagination={{ pageSize: 10 }} />
            </div>
          )},
        ]} />

        <Drawer title="任务详情" open={drawerOpen} onClose={() => setDrawerOpen(false)} width={480}>
          {store.selectedTask && (
            <>
              <Descriptions column={1} bordered size="small">
                <Descriptions.Item label="ID">{store.selectedTask.id}</Descriptions.Item>
                <Descriptions.Item label="名称">{store.selectedTask.name}</Descriptions.Item>
                <Descriptions.Item label="状态"><Tag color={STATUS_COLORS[store.selectedTask.status]}>{store.selectedTask.status === 'paused' ? '已暂停' : store.selectedTask.status}</Tag></Descriptions.Item>
                <Descriptions.Item label="执行节点">
                  <Space>
                    {store.selectedTask.node}
                    {store.isNodeInMaintenance(store.selectedTask.node) && <Tag color="orange">维护中</Tag>}
                  </Space>
                </Descriptions.Item>
                <Descriptions.Item label="重试次数">{store.selectedTask.retries}/{store.selectedTask.maxRetries}</Descriptions.Item>
                <Descriptions.Item label="创建时间">{new Date(store.selectedTask.createdAt).toLocaleString()}</Descriptions.Item>
                <Descriptions.Item label="耗时">{store.selectedTask.duration ? `${(store.selectedTask.duration / 1000).toFixed(1)}s` : '-'}</Descriptions.Item>
              </Descriptions>
              <h4 style={{ marginTop: 16 }}>执行日志</h4>
              <pre style={{ background: '#1f1f1f', padding: 12, borderRadius: 8, fontSize: 12, maxHeight: 300, overflow: 'auto' }}>
                {store.selectedTask.logs.join('\n')}
              </pre>
            </>
          )}
        </Drawer>

        <Modal
          title="新建维护窗口"
          open={mwModalOpen}
          onOk={handleCreateMW}
          onCancel={handleCloseMWModal}
          okText="创建"
          cancelText="取消"
          destroyOnClose
          maskClosable={false}
        >
          <Form form={mwForm} layout="vertical" preserve={false}>
            <Form.Item
              name="nodeId"
              label="目标节点"
              rules={[{ required: true, message: '请选择目标节点' }]}
            >
              <Select
                placeholder="选择节点"
                options={nodeOptions}
                style={{ width: '100%' }}
                optionFilterProp="label"
              />
            </Form.Item>
            <Form.Item
              name="reason"
              label="维护原因"
              rules={[{ required: true, message: '请输入维护原因' }]}
            >
              <Input.TextArea rows={2} placeholder="例如：系统升级、硬件更换" />
            </Form.Item>
            <Form.Item
              name="timeRange"
              label="维护时间范围"
              rules={[{ required: true, message: '请选择维护时间范围' }]}
            >
              <RangePicker
                showTime={{ format: 'HH:mm' }}
                format="YYYY-MM-DD HH:mm"
                style={{ width: '100%' }}
                disabledDate={disabledDate}
                placeholder={['开始时间', '结束时间']}
              />
            </Form.Item>
          </Form>
        </Modal>
      </Content>
    </Layout>
  )
}
