import React, { createContext, useContext, useReducer, useEffect } from 'react';
import axios from 'axios';

const ProjectContext = createContext();

const initialState = {
  projects: [],
  currentProject: null,
  loading: false,
  error: null
};

const projectReducer = (state, action) => {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'SET_PROJECTS':
      return { ...state, projects: action.payload };
    case 'ADD_PROJECT':
      return { ...state, projects: [action.payload, ...state.projects] };
    case 'UPDATE_PROJECT':
      return {
        ...state,
        projects: state.projects.map(p => 
          p.id === action.payload.id ? action.payload : p
        ),
        currentProject: state.currentProject?.id === action.payload.id 
          ? action.payload 
          : state.currentProject
      };
    case 'SET_CURRENT_PROJECT':
      return { ...state, currentProject: action.payload };
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    default:
      return state;
  }
};

export const ProjectProvider = ({ children }) => {
  const [state, dispatch] = useReducer(projectReducer, initialState);

  // Load projects on mount
  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true });
      const response = await axios.get('/api/projects');
      dispatch({ type: 'SET_PROJECTS', payload: response.data });
    } catch (error) {
      dispatch({ type: 'SET_ERROR', payload: 'Failed to load projects' });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  const createProject = async (projectData) => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true });
      const response = await axios.post('/api/projects', projectData);
      
      // Add the new project to the list
      const newProject = {
        id: response.data.projectId,
        ...projectData,
        status: 'processing',
        createdAt: new Date().toISOString()
      };
      
      dispatch({ type: 'ADD_PROJECT', payload: newProject });
      
      // Start polling for updates - don't set loading to false here
      // Loading will be set to false when the project status changes
      pollProjectStatus(response.data.projectId);
      
      return response.data.projectId;
    } catch (error) {
      dispatch({ type: 'SET_ERROR', payload: 'Failed to create project' });
      dispatch({ type: 'SET_LOADING', payload: false });
      throw error;
    }
    // Removed the finally block - loading state is managed by polling
  };

  const loadProject = async (projectId) => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true });
      const response = await axios.get(`/api/projects/${projectId}`);
      dispatch({ type: 'SET_CURRENT_PROJECT', payload: response.data });
      return response.data;
    } catch (error) {
      dispatch({ type: 'SET_ERROR', payload: 'Failed to load project' });
      throw error;
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  const pollProjectStatus = async (projectId) => {
    const pollInterval = setInterval(async () => {
      try {
        const response = await axios.get(`/api/projects/${projectId}`);
        const project = response.data;
        
        dispatch({ type: 'UPDATE_PROJECT', payload: project });
        
        if (project.status === 'completed' || project.status === 'failed') {
          clearInterval(pollInterval);
          // Set loading to false when project processing is complete
          dispatch({ type: 'SET_LOADING', payload: false });
        }
      } catch (error) {
        console.error('Error polling project status:', error);
        clearInterval(pollInterval);
        // Set loading to false on error
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    }, 2000); // Poll every 2 seconds
  };

  const clearError = () => {
    dispatch({ type: 'CLEAR_ERROR' });
  };

  const value = {
    ...state,
    createProject,
    loadProject,
    loadProjects,
    clearError
  };

  return (
    <ProjectContext.Provider value={value}>
      {children}
    </ProjectContext.Provider>
  );
};

export const useProjects = () => {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error('useProjects must be used within a ProjectProvider');
  }
  return context;
};