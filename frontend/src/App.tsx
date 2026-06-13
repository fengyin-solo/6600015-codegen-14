import { useEffect } from 'react'
import { ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import 'dayjs/locale/zh-cn'
import dayjs from 'dayjs'
import Dashboard from './components/Dashboard'
import { useTaskStore } from './store/tasks'

dayjs.locale('zh-cn')

export default function App() {
  const addMetric = useTaskStore(s => s.addMetric)
  const refreshNodes = useTaskStore(s => s.refreshNodes)
  const tickMaintenanceWindows = useTaskStore(s => s.tickMaintenanceWindows)

  useEffect(() => {
    const interval = setInterval(() => { addMetric(); refreshNodes(); tickMaintenanceWindows() }, 5000)
    return () => clearInterval(interval)
  }, [])

  return (
    <ConfigProvider locale={zhCN} theme={{ algorithm: theme.darkAlgorithm }}>
      <div style={{ minHeight: '100vh', background: '#141414' }}>
        <Dashboard />
      </div>
    </ConfigProvider>
  )
}
