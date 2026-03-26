import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminSidebar from './AdminSidebar';
import AdminTopbar from './AdminTopbar';
import socketService from '../../services/socketService';
import { Bell, X } from 'lucide-react';

export default function AdminLayout({ children, title }) {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState([]);

  useEffect(() => {
    const adminData = JSON.parse(localStorage.getItem('admin_data') || '{}');
    const token = localStorage.getItem('admin_token');
    
    if (!token) {
      navigate('/admin/login');
      return;
    }

    // Connect Socket for Admin
    if (adminData.id) {
      socketService.connect(adminData.id, 'admin');
      
      // Listen for admin alerts
      const handleAdminAlert = (alert) => {
        const id = Date.now();
        setAlerts(prev => [...prev, { ...alert, id }]);
        
        // Auto-remove after 8 seconds
        setTimeout(() => {
          setAlerts(prev => prev.filter(a => a.id !== id));
        }, 8000);
      };

      socketService.on('adminAlert', handleAdminAlert);
      
      return () => {
        socketService.off('adminAlert', handleAdminAlert);
      };
    }
  }, [navigate]);

  return (
    <div className="min-h-screen bg-black flex overflow-hidden">
      <AdminSidebar />
      <div className="flex-1 ml-64 flex flex-col h-screen overflow-hidden">
        <AdminTopbar title={title} />
        <main className="flex-1 p-8 overflow-y-auto relative">
          {children}
          
          {/* Real-time Admin Alerts Toast Container */}
          <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3 max-w-sm">
            {alerts.map((alert) => (
              <div 
                key={alert.id}
                className={`flex items-start gap-3 p-4 rounded-xl border animate-in slide-in-from-right duration-300 ${
                  alert.type === 'HIGH_VALUE' ? 'bg-emerald-950 border-emerald-500/30 text-emerald-400' :
                  alert.type === 'EMAIL_FAILURE' ? 'bg-red-950 border-red-500/30 text-red-400' :
                  'bg-zinc-900 border-zinc-800 text-sky-400'
                }`}
              >
                <div className="p-2 rounded-lg bg-black/20">
                  <Bell className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <div className="text-xs font-bold uppercase tracking-wider opacity-60 mb-1">{alert.type.replace('_', ' ')}</div>
                  <p className="text-sm font-medium">{alert.message}</p>
                </div>
                <button 
                  onClick={() => setAlerts(prev => prev.filter(a => a.id !== alert.id))}
                  className="p-1 hover:bg-black/20 rounded"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
