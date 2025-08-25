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
  Folder,
  Download
} from 'lucide-react';
import Loader from '../components/Loader';

const Projects = () => {
  const { projects, loading, error, loadProjects, clearError } = useProjects();

  useEffect(() => {
    // Only load projects once when component mounts
    console.log('Projects component mounted, loading projects...');
    loadProjects();
  }, []); // Remove loadProjects from dependencies to prevent infinite re-renders

  // Debug logging
  console.log('Projects component render:', { loading, error, projectsCount: projects.length });
  console.log('Projects data:', projects);

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'processing':
        return <Loader size="small" />;
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
          <Loader size="default" className="mx-auto mb-4" />
          <p className="text-gray-600">Loading projects...</p>
          <p className="text-sm text-gray-500 mt-2">This may take a moment...</p>
          <button
            onClick={() => {
              clearError();
              loadProjects();
            }}
            className="btn-secondary mt-4"
          >
            Retry Loading
          </button>
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
             <div className="flex gap-2">
               <button
                 onClick={() => {
                   clearError();
                   loadProjects();
                 }}
                 className="btn-secondary text-sm px-3 py-1"
               >
                 Retry
               </button>
               <button
                 onClick={() => {
                   clearError();
                   // Force reload the page as a last resort
                   window.location.reload();
                 }}
                 className="btn-secondary text-sm px-3 py-1 bg-red-100 text-red-800 border-red-300 hover:bg-red-200"
               >
                 Reload Page
               </button>
             </div>
           </div>
         </div>
       )}

       {/* Debug Info - Always show for troubleshooting */}
       <div className="mt-8 p-4 bg-gray-100 rounded-lg text-xs text-gray-600">
         <p><strong>Debug Info:</strong></p>
         <p>Loading: {loading.toString()}</p>
         <p>Projects Count: {projects.length}</p>
         <p>Error: {error || 'None'}</p>
         <p>API Base URL: {window.location.origin}</p>
         <p>Projects Data: {JSON.stringify(projects, null, 2)}</p>
       </div>

                    {/* Projects Grid */}
       {!loading && (!projects || projects.length === 0 || projects.filter(p => p && p.id && p.repoUrl).length === 0) ? (
         <div className="card text-center py-16">
           <BookOpen className="w-16 h-16 text-gray-400 mx-auto mb-4" />
           <h3 className="text-xl font-semibold text-gray-900 mb-2">
             {!projects ? 'Error loading projects' : 
               projects.filter(p => p && p.id && p.repoUrl).length === 0 ? 'No valid projects found' : 'No projects yet'}
           </h3>
           <p className="text-gray-600 mb-6 max-w-md mx-auto">
             {!projects 
               ? 'There was an issue loading your projects. Please check the debug info below and try refreshing the page.'
               : projects.filter(p => p && p.id && p.repoUrl).length === 0
               ? 'All projects appear to have invalid data. Please check the debug info below and try refreshing the page.'
               : 'Get started by creating your first documentation project. Connect a Git repository and we\'ll generate comprehensive docs automatically.'
             }
           </p>
           {!projects || projects.filter(p => p && p.id && p.repoUrl).length === 0 ? (
             <button onClick={() => window.location.reload()} className="btn-primary">
               Reload Page
             </button>
           ) : (
             <Link to="/" className="btn-primary">
               Create Your First Project
             </Link>
           )}
         </div>
             ) : !loading && projects && projects.filter(p => p && p.id && p.repoUrl).length > 0 ? (
                 <div className="grid gap-6">
           {projects.filter(project => project && project.id && project.repoUrl).map((project) => (
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
                             {project.repoUrl ? project.repoUrl.replace(/^https?:\/\//, '').replace(/\.git$/, '') : 'No URL'}
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
                  {project.status === 'completed' && (
                    <a
                      href={`/api/projects/${project.id}/readme`}
                      download
                      className="btn-secondary text-center inline-flex items-center justify-center space-x-2"
                    >
                      <Download className="w-4 h-4" />
                      <span>Download README</span>
                    </a>
                  )}
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
      ) : null}
      
      
    </div>
  );
};

export default Projects;