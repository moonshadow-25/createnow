import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjectStore } from '@/store/projectStore';
import { useToast } from '@/components/common/Toast';
import { Plus, FolderOpen, Trash2 } from 'lucide-react';

export default function HomePage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { projects, loading, fetchProjects, createProject, deleteProject, setCurrentProject } =
    useProjectStore();

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleCreateProject = async () => {
    const name = prompt('请输入项目名称:');
    if (name) {
      try {
        const project = await createProject(name);
        setCurrentProject(project);
        navigate(`/project/${project.project_id}`);
      } catch (error) {
        toast('创建项目失败', 'error');
      }
    }
  };

  const handleDeleteProject = async (id: string) => {
    if (confirm('确定要删除这个项目吗？')) {
      try {
        await deleteProject(id);
      } catch (error) {
        toast('删除项目失败', 'error');
      }
    }
  };

  const handleOpenProject = (project: any) => {
    setCurrentProject(project);
    navigate(`/project/${project.project_id}`);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">AI短片生成软件</h1>
          <button
            onClick={handleCreateProject}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition"
          >
            <Plus size={20} />
            新建项目
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12">加载中...</div>
        ) : projects.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-xl mb-4">还没有项目</p>
            <button
              onClick={handleCreateProject}
              className="text-blue-400 hover:text-blue-300 underline"
            >
              创建第一个项目
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <div
                key={project.project_id}
                className="bg-gray-800 rounded-lg p-6 hover:bg-gray-750 transition cursor-pointer"
              >
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-xl font-semibold flex-1">{project.name}</h3>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteProject(project.project_id);
                    }}
                    className="text-red-400 hover:text-red-300 p-1"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <p className="text-gray-400 text-sm mb-4 line-clamp-2">
                  {project.description || '暂无描述'}
                </p>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-500">
                    {new Date(project.created_at).toLocaleDateString()}
                  </span>
                  <button
                    onClick={() => handleOpenProject(project)}
                    className="flex items-center gap-1 text-blue-400 hover:text-blue-300 text-sm"
                  >
                    <FolderOpen size={16} />
                    打开
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
