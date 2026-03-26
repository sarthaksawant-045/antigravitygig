import { User } from 'lucide-react';

export default function AdminTopbar({ title }) {
  return (
    <div className="bg-zinc-900 border-b border-zinc-800 px-8 py-4 flex items-center justify-between">
      <h2 className="text-2xl font-bold text-white">{title}</h2>

      <div className="flex items-center gap-3 px-4 py-2 bg-zinc-800 rounded-lg">
        <div className="w-8 h-8 bg-sky-500 rounded-full flex items-center justify-center">
          <User className="w-4 h-4 text-white" />
        </div>
        <div className="text-sm">
          <p className="text-white font-medium">Admin</p>
          <p className="text-gray-400 text-xs">Administrator</p>
        </div>
      </div>
    </div>
  );
}
