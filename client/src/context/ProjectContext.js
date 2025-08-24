import React, { createContext, useContext, useReducer, useEffect } from 'react';
import axios from 'axios';
import { apiBaseUrl } from '../config';

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
    loadProjects().catch(error => {
      console.error('Failed to load projects on mount:', error);
      // Don't let the error crash the app
    });
  }, []);

  // Global failsafe: reset loading state if it gets stuck
  useEffect(() => {
    const resetTimer = setTimeout(() => {
      if (state.loading) {
        console.log('Global failsafe: resetting stuck loading state');
        dispatch({ type: 'SET_LOADING', payload: false });
        dispatch({ type: 'SET_ERROR', payload: 'Loading state was reset due to timeout. Please try again.' });
      }
    }, 60000); // 1 minute global failsafe

    return () => clearTimeout(resetTimer);
  }, [state.loading]);

  const loadProjects = async () => {
    try {
      console.log('Loading projects...');
      dispatch({ type: 'SET_LOADING', payload: true });
      
      // Add timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      const response = await axios.get(`${apiBaseUrl}/api/projects`, {
        signal: controller.signal,
        timeout: 10000
      });
      
      clearTimeout(timeoutId);
      console.log('Projects loaded:', response.data);
      dispatch({ type: 'SET_PROJECTS', payload: response.data });
    } catch (error) {
      console.error('Error loading projects:', error);
      if (error.name === 'AbortError') {
        dispatch({ type: 'SET_ERROR', payload: 'Request timed out. Please check if the backend is running.' });
      } else {
        dispatch({ type: 'SET_ERROR', payload: 'Failed to load projects' });
      }
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  const createProject = async (projectData) => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true });
      
      // Add overall timeout for project creation - much shorter to prevent browser freezing
      const createTimeout = setTimeout(() => {
        console.log('Project creation timeout - forcing loading to false');
        dispatch({ type: 'SET_ERROR', payload: 'Project creation timeout. Please check the project status manually.' });
        dispatch({ type: 'SET_LOADING', payload: false });
      }, 30000); // 30 seconds total timeout - much shorter
      
      const response = await axios.post(`${apiBaseUrl}/api/projects`, projectData, {
        timeout: 15000 // 15 second timeout for initial request
      });
      
      // Clear the overall timeout since we got a response
      clearTimeout(createTimeout);
      
      // Add the new project to the list
      const newProject = {
        id: response.data.projectId,
        ...projectData,
        status: 'processing',
        createdAt: new Date().toISOString()
      };
      
      dispatch({ type: 'ADD_PROJECT', payload: newProject });
      
      // Start polling for updates with a much shorter timeout
      pollProjectStatus(response.data.projectId);
      
      return response.data.projectId;
    } catch (error) {
      console.error('Project creation error:', error);
      dispatch({ type: 'SET_ERROR', payload: 'Failed to create project' });
      dispatch({ type: 'SET_LOADING', payload: false });
      throw error;
    }
  };

  const loadProject = async (projectId) => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true });
      const response = await axios.get(`${apiBaseUrl}/api/projects/${projectId}`);
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
    console.log(`Starting to poll project status for: ${projectId}`);
    let pollCount = 0;
    const maxPolls = 15; // Maximum 15 polls (30 seconds total)
    
    // Add a failsafe timeout that will force stop loading
    const failsafeTimeout = setTimeout(() => {
      console.log(`Failsafe timeout for project ${projectId} - forcing loading to false`);
      dispatch({ type: 'SET_ERROR', payload: 'Project processing timeout. Please check the project status manually.' });
      dispatch({ type: 'SET_LOADING', payload: false });
    }, 30000); // 30 second failsafe
    
    const pollInterval = setInterval(async () => {
      pollCount++;
      console.log(`Polling project ${projectId} (attempt ${pollCount})`);
      
      try {
        const response = await axios.get(`${apiBaseUrl}/api/projects/${projectId}`, {
          timeout: 5000 // 5 second timeout for each poll - much shorter
        });
        const project = response.data;
        
        console.log(`Project ${projectId} status:`, project.status);
        dispatch({ type: 'UPDATE_PROJECT', payload: project });
        
        if (project.status === 'completed' || project.status === 'failed') {
          console.log(`Project ${projectId} finished with status: ${project.status}`);
          clearInterval(pollInterval);
          clearTimeout(failsafeTimeout);
          dispatch({ type: 'SET_LOADING', payload: false });
        } else if (pollCount >= maxPolls) {
          console.log(`Project ${projectId} polling timeout after ${maxPolls} attempts`);
          clearInterval(pollInterval);
          clearTimeout(failsafeTimeout);
          dispatch({ type: 'SET_ERROR', payload: 'Project processing timeout. Please check the project status.' });
          dispatch({ type: 'SET_LOADING', payload: false });
        }
      } catch (error) {
        console.error(`Error polling project ${projectId} (attempt ${pollCount}):`, error);
        if (pollCount >= maxPolls) {
          clearInterval(pollInterval);
          clearTimeout(failsafeTimeout);
          dispatch({ type: 'SET_ERROR', payload: 'Failed to get project status. Please check the project manually.' });
          dispatch({ type: 'SET_LOADING', payload: false });
        }
      }
    }, 1000); // Poll every 1 second - much more aggressive
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