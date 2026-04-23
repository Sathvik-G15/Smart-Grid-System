import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import Navbar    from './components/Navbar';
import Dashboard from './pages/Dashboard';
import Predict   from './pages/Predict';
import Analytics from './pages/Analytics';
import ModelInfo from './pages/ModelInfo';
import Map       from './pages/Map';

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex min-h-screen bg-dark-950 bg-grid-pattern">
        <Navbar />
        <main className="flex-1 ml-64 p-8 overflow-y-auto min-h-screen">
          <Routes>
            <Route path="/"          element={<Dashboard />} />
            <Route path="/predict"   element={<Predict />}   />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/model"     element={<ModelInfo />} />
            <Route path="/map"       element={<Map />}       />
          </Routes>
        </main>
      </div>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#0d1520', color: '#f3f4f6',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '12px', fontSize: '13px',
          },
          success: { iconTheme: { primary: '#22a362', secondary: '#0d1520' } },
          error:   { iconTheme: { primary: '#ef4444', secondary: '#0d1520' } },
        }}
      />
    </BrowserRouter>
  );
}
