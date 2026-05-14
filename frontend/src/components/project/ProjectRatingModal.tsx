import { X, Star } from 'lucide-react';
import { Project } from '@/types';

interface Props {
  project: Project;
  onClose: () => void;
}

export function ProjectRatingModal({ project, onClose }: Props) {
  const hasRating = project.rating != null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-xl w-full max-w-md mx-4 p-6 shadow-2xl">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-semibold">项目评分</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-500 mb-1">项目名称</label>
            <p className="text-white">{project.name}</p>
          </div>

          <div>
            <label className="block text-sm text-gray-500 mb-1">评分</label>
            {hasRating ? (
              <div className="flex items-center gap-2">
                <Star size={20} className="text-yellow-400 fill-yellow-400" />
                <span className="text-2xl font-bold text-yellow-400">{project.rating}</span>
                <span className="text-sm text-gray-500">/ 10</span>
              </div>
            ) : (
              <p className="text-gray-500 italic">暂无评分</p>
            )}
          </div>

          <div>
            <label className="block text-sm text-gray-500 mb-1">评论</label>
            {project.review ? (
              <p className="text-gray-200 bg-gray-700/50 rounded-lg p-3 whitespace-pre-wrap">{project.review}</p>
            ) : (
              <p className="text-gray-500 italic">暂无评论</p>
            )}
          </div>
        </div>

        <div className="flex justify-end mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
