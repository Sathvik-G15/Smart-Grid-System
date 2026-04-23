import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Zap, BarChart3, BrainCircuit, Bolt, Map } from 'lucide-react';

const links = [
  { to: '/',          label: 'Dashboard',  icon: LayoutDashboard },
  { to: '/predict',   label: 'Predict',    icon: Zap             },
  { to: '/analytics', label: 'Analytics',  icon: BarChart3       },
  { to: '/model',     label: 'Model Info', icon: BrainCircuit    },
  { to: '/map',       label: 'Grid Map',   icon: Map             },
];

export default function Navbar() {
  return (
    <aside className="fixed left-0 top-0 h-screen w-64 bg-dark-850 border-r border-white/5 flex flex-col z-40">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center shadow-lg shadow-primary-900/50">
            <Bolt size={18} className="text-white" />
          </div>
          <div>
            <p className="text-white font-bold text-sm leading-tight">SmartGrid</p>
            <p className="text-primary-400 text-xs font-medium">AI Demand System</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider px-3 mb-3">
          Navigation
        </p>
        {links.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <Icon size={17} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-white/5">
        <div className="bg-primary-600/10 border border-primary-500/20 rounded-xl p-3">
          <p className="text-primary-400 text-xs font-semibold">Multi-Location Model</p>
          <p className="text-gray-500 text-xs mt-0.5">14 sites · 2011–2017 · 1H</p>
        </div>
      </div>
    </aside>
  );
}
