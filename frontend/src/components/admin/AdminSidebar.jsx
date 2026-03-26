import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, FileCheck, ScrollText, LogOut, Briefcase, IndianRupee, AlertTriangle } from 'lucide-react';
import { adminAuthApi } from '../../services/adminApi';
import { useNavigate } from 'react-router-dom';
import BrandLogo from '../BrandLogo.jsx';

export default function AdminSidebar() {
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    adminAuthApi.logout();
    navigate('/admin/login');
  };

  const navItems = [
    { path: '/admin/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { path: '/admin/projects', icon: Briefcase, label: 'Projects' },
    { path: '/admin/payments', icon: IndianRupee, label: 'Payments' },
    { path: '/admin/tickets', icon: AlertTriangle, label: 'Dispute Center' },
    { path: '/admin/email-logs', icon: ScrollText, label: 'Email Logs' },
    { path: '/admin/clients', icon: Users, label: 'Clients' },
    { path: '/admin/freelancers', icon: Briefcase, label: 'Freelancers' },
    { path: '/admin/kyc', icon: FileCheck, label: 'KYC Verification' },
    { path: '/admin/audit-logs', icon: ScrollText, label: 'Audit Logs' },
  ];

  return (
    <div className="w-64 bg-zinc-900 border-r border-zinc-800 h-screen flex flex-col fixed left-0 top-0">
      <div className="p-6 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <div>
            <BrandLogo to="/admin/dashboard" size="sm" textClassName="text-white" />
            <p className="text-gray-400 text-xs">Admin Panel</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;

          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                isActive
                  ? 'bg-sky-500 text-white'
                  : 'text-gray-400 hover:bg-zinc-800 hover:text-white'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-zinc-800">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-4 py-3 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors w-full"
        >
          <LogOut className="w-5 h-5" />
          <span className="font-medium">Logout</span>
        </button>
      </div>
    </div>
  );
}
