import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useProjects } from '../context/ProjectContext';
import { 
  BookOpen, 
  GitBranch, 
  Clock, 
  CheckCircle, 
  AlertCircle,
  Plus,
  Calendar,
  FileText,
  Folder
} from 'lucide-react';

const Projects = () => {
  const { projects, loading, error, loadProjects, clearError } = useProjects();

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'processing':
        return <Clock className="w-5 h-5 text-blue-600 animate-pulse" />;
      case 'failed':
        return <AlertCircle className="w-5 h-5 text-red-600" />;
      default:
        return <Clock className="w-5 h-5 text-gray-600" />;
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'completed':
        return 'badge-success';
      case 'processing':
        return 'badge-info';
      case 'failed':
        return 'badge-error';
      default:
        return 'badge-warning';
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'completed':
        return 'Completed';
      case 'processing':
        return 'Processing';
      case 'failed':
        return 'Failed';
      default:
        return 'Unknown';
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="card text-center py-16">
        <div className="text-center">
          <Clock className="w-12 h-12 text-primary-600 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading projects...</p>
          <p className="text-sm text-gray-500 mt-2">This may take a moment...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Your Projects</h1>
          <p className="text-gray-600 mt-2">
            Manage and view all your documentation projects
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              clearError();
              loadProjects();
            }}
            className="btn-secondary inline-flex items-center space-x-2"
          >
            <Clock className="w-5 h-5" />
            <span>Refresh</span>
          </button>
          <Link
            to="/"
            className="btn-primary inline-flex items-center space-x-2"
          >
            <Plus className="w-5 h-5" />
            <span>New Project</span>
          </Link>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="card border-red-200 bg-red-50">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 text-red-800">
              <AlertCircle className="w-5 h-5" />
              <span>{error}</span>
            </div>
            <button
              onClick={() => {
                clearError();
                loadProjects();
              }}
              className="btn-secondary text-sm px-3 py-1"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Projects Grid */}
      {projects.length === 0 ? (
        <div className="card text-center py-16">
          <BookOpen className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-900 mb-2">
            No projects yet
          </h3>
          <p className="text-gray-600 mb-6 max-w-md mx-auto">
            Get started by creating your first documentation project. 
            Connect a Git repository and we'll generate comprehensive docs automatically.
          </p>
          <Link to="/" className="btn-primary">
            Create Your First Project
          </Link>
        </div>
      ) : (
        <div className="grid gap-6">
          {projects.map((project) => (
            <div key={project.id} className="card hover:shadow-md transition-shadow duration-200">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
                        <BookOpen className="w-5 h-5 text-primary-600" />
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">
                          {project.projectName}
                        </h3>
                        <div className="flex items-center space-x-2 text-sm text-gray-500">
                          <GitBranch className="w-4 h-4" />
                          <span className="font-mono">
                            {project.repoUrl.replace(/^https?:\/\//, '').replace(/\.git$/, '')}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      {getStatusIcon(project.status)}
                      <span className={`badge ${getStatusBadge(project.status)}`}>
                        {getStatusText(project.status)}
                      </span>
                    </div>
                  </div>

                  {project.description && (
                    <p className="text-gray-600 mb-3">
                      {project.description}
                    </p>
                  )}

                  <div className="flex items-center space-x-4 text-sm text-gray-500">
                    <div className="flex items-center space-x-1">
                      <Calendar className="w-4 h-4" />
                      <span>Created {formatDate(project.createdAt)}</span>
                    </div>
                    {project.completedAt && (
                      <div className="flex items-center space-x-1">
                        <CheckCircle className="w-4 h-4" />
                        <span>Completed {formatDate(project.completedAt)}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <Link
                    to={`/projects/${project.id}`}
                    className="btn-primary text-center"
                  >
                    View Documentation
                  </Link>
                  {project.status === 'failed' && (
                    <button className="btn-secondary">
                      Retry
                    </button>
                  )}
                  {project.status === 'processing' && (
                    <button 
                      onClick={async () => {
                        try {
                          const response = await fetch(`${window.location.origin}/api/projects/${project.id}`);
                          const updatedProject = await response.json();
                          console.log('Manual status check for project:', updatedProject);
                          // Force a refresh of the projects list
                          loadProjects();
                        } catch (error) {
                          console.error('Manual status check failed:', error);
                        }
                      }}
                      className="btn-secondary"
                    >
                      Check Status
                    </button>
                  )}
                </div>
              </div>

              {/* Project Stats */}
              {project.documentation && (
                <div className="mt-6 pt-6 border-t border-gray-200">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-primary-600">
                        {project.documentation.summary?.totalFiles || 0}
                      </div>
                      <div className="text-sm text-gray-600">Files</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-primary-600">
                        {project.documentation.summary?.totalDirectories || 0}
                      </div>
                      <div className="text-sm text-gray-600">Directories</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-primary-600">
                        {Object.keys(project.documentation.summary?.languages || {}).length}
                      </div>
                      <div className="text-sm text-gray-600">Languages</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-primary-600">
                        {project.documentation.readme ? 'Yes' : 'No'}
                      </div>
                      <div className="text-sm text-gray-600">README</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Projects;