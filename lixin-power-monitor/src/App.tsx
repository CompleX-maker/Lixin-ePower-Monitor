import { Routes, Route } from 'react-router'
import Home from './pages/Home'
import { LoginGate } from './components/LoginGate'

export default function App() {
  return (
    <LoginGate>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </LoginGate>
  )
}
