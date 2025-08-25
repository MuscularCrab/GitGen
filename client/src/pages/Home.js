import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useProjects } from '../context/ProjectContext';
import { apiBaseUrl } from '../config';
import { 
  BookOpen, 
  GitBranch, 
  Zap, 
  Shield, 
  Users, 
  ArrowRight,
  CheckCircle,
  Clock,
  AlertCircle
} from 'lucide-react';
import Loader from '../components/Loader';

const Home = () => {
  const { createProject, loading, error, clearError } = useProjects();
  const [formData, setFormData] = useState({
    repoUrl: ''
  });

  // Add AI status display
  const [aiConfig, setAiConfig] = useState(null);
  const [aiLoading, setAiLoading] = useState(true);

  // Add progress tracking
  const [progress, setProgress] = useState({
    isProcessing: false,
    percentage: 0,
    stage: '',
    message: ''
  });

  useEffect(() => {
    const checkAIStatus = async () => {
      try {
        setAiLoading(true);
        const response = await fetch('/api/ai-config');
        const config = await response.json();
        setAiConfig(config);
      } catch (error) {
        console.error('Failed to check AI status:', error);
      } finally {
        setAiLoading(false);
      }
    };
    
    checkAIStatus();
  }, []);

  // Cleanup progress intervals on unmount
  useEffect(() => {
    return () => {
      // Cleanup any running progress intervals
      if (progress.isProcessing) {
        setProgress(prev => ({ ...prev, isProcessing: false }));
      }
    };
  }, [progress.isProcessing]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    clearError();
    
    // Extract project name from GitHub URL
    const urlParts = formData.repoUrl.split('/');
    const projectName = urlParts[urlParts.length - 1] || 'Project';
    
    const projectData = {
      repoUrl: formData.repoUrl,
      projectName: projectName,
      description: '' // AI will generate this from code analysis
    };
    
    console.log('Form submitted with data:', projectData);
    
    // Start progress tracking
    setProgress({
      isProcessing: true,
      percentage: 0,
      stage: 'Initializing',
      message: 'Starting repository analysis...'
    });
    
    // Start progress simulation
    const progressInterval = simulateProgress();
    
    try {
      console.log('Calling createProject...');
      const projectId = await createProject(projectData);
      console.log('Project created successfully with ID:', projectId);
      
      // Clear progress interval and update to completion
      clearInterval(progressInterval);
      setProgress({
        isProcessing: true,
        percentage: 100,
        stage: 'Complete',
        message: 'Redirecting to project details...'
      });
      
      // Redirect to project detail page
      setTimeout(() => {
        window.location.href = `/projects/${projectId}`;
      }, 1000);
      
    } catch (error) {
      console.error('Failed to create project:', error);
      clearInterval(progressInterval);
      setProgress({
        isProcessing: false,
        percentage: 0,
        stage: 'Error',
        message: 'Failed to process repository'
      });
    }
  };

  const handleInputChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  // Simulate progress updates during processing
  const simulateProgress = () => {
    const stages = [
      { percentage: 10, stage: 'Cloning', message: 'Cloning repository from GitHub...' },
      { percentage: 25, stage: 'Analyzing', message: 'Analyzing repository structure...' },
      { percentage: 40, stage: 'Scanning', message: 'Scanning source code files...' },
      { percentage: 60, stage: 'Processing', message: 'Processing code patterns and functions...' },
      { percentage: 80, stage: 'Generating', message: 'Generating README with AI...' },
      { percentage: 95, stage: 'Finalizing', message: 'Finalizing documentation...' }
    ];

    let currentStage = 0;
    const progressInterval = setInterval(() => {
      if (currentStage < stages.length && progress.isProcessing) {
        setProgress(prev => ({
          ...prev,
          ...stages[currentStage]
        }));
        currentStage++;
      } else if (currentStage >= stages.length) {
        clearInterval(progressInterval);
      }
    }, 2000); // Update every 2 seconds

    return progressInterval;
  };

  const features = [
    {
      icon: Zap,
      title: 'Lightning Fast',
      description: 'Generate comprehensive documentation in seconds, not minutes.'
    },
    {
      icon: Shield,
      title: 'Secure & Private',
      description: 'Your code stays private. We only process what you share.'
    },
    {
      icon: Users,
      title: 'Team Collaboration',
      description: 'Share documentation with your team and stakeholders.'
    },
    {
      icon: BookOpen,
      title: 'Smart Analysis',
      description: 'AI-powered code analysis for better documentation.'
    }
  ];

  const supportedLanguages = [
    'JavaScript', 'TypeScript', 'Python', 'Java', 'C++', 'C#', 'PHP',
    'Ruby', 'Go', 'Rust', 'Swift', 'Kotlin', 'Scala', 'Clojure'
  ];

  return (
    <div className="space-y-16">
      {/* Hero Section */}
      <section className="text-center py-16">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-6">
            Generate Documentation
            <span className="text-primary-600"> Automatically</span>
          </h1>
                     <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
             Transform your Git repositories into beautiful, comprehensive documentation 
             with just a few clicks. Generate brand new README files automatically based on your code analysis.
           </p>
          
          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/projects"
              className="btn-primary text-lg px-8 py-3 inline-flex items-center space-x-2"
            >
              <span>View Projects</span>
              <ArrowRight className="w-5 h-5" />
            </Link>
            <a
              href="#how-it-works"
              className="btn-secondary text-lg px-8 py-3"
            >
              Learn More
            </a>
          </div>
        </div>
      </section>

      {/* Project Creation Form */}
      <section className="max-w-2xl mx-auto">
        <div className="card">
                     <div className="text-center mb-8">
             <h2 className="text-3xl font-bold text-gray-900 mb-2">
               Generate README from GitHub
             </h2>
                          <p className="text-gray-600">
                Just paste your GitHub repository URL and we'll analyze the code to generate a professional README automatically.
              </p>
           </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-center space-x-2 text-red-800">
                <AlertCircle className="w-5 h-5" />
                <span>{error}</span>
              </div>
            </div>
          )}

          

                     <form onSubmit={handleSubmit} className="space-y-6">
             <div>
               <label htmlFor="repoUrl" className="block text-sm font-medium text-gray-700 mb-2">
                 GitHub Repository URL *
               </label>
               <input
                 type="url"
                 id="repoUrl"
                 name="repoUrl"
                 value={formData.repoUrl}
                 onChange={handleInputChange}
                 placeholder="https://github.com/username/repository"
                 className="input-field"
                 required
               />
               <p className="mt-1 text-sm text-gray-500">
                 Just paste the GitHub URL - we'll analyze the code and generate everything else automatically
               </p>
             </div>

                         <button
               type="submit"
               disabled={loading || progress.isProcessing}
               className="btn-primary w-full py-3 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
             >
               {loading || progress.isProcessing ? (
                 <div className="flex items-center justify-center space-x-2">
                   <Loader size="small" />
                   <span>Processing...</span>
                 </div>
               ) : (
                 <div className="flex items-center justify-center space-x-2">
                   <BookOpen className="w-5 h-5" />
                   <span>Generate Documentation</span>
                 </div>
               )}
             </button>
           </form>

           {/* Progress Indicator */}
           {progress.isProcessing && (
             <div className="mt-6 p-6 bg-blue-50 border border-blue-200 rounded-lg">
               <div className="flex items-center justify-between mb-3">
                 <h3 className="text-lg font-semibold text-blue-800">
                   {progress.stage}
                 </h3>
                 <span className="text-sm font-medium text-blue-600">
                   {progress.percentage}%
                 </span>
               </div>
               
               {/* Progress Bar */}
               <div className="w-full bg-blue-200 rounded-full h-3 mb-3">
                 <div 
                   className="bg-blue-600 h-3 rounded-full transition-all duration-500 ease-out"
                   style={{ width: `${progress.percentage}%` }}
                 ></div>
               </div>
               
               {/* Progress Message */}
               <p className="text-sm text-blue-700 mb-2">
                 {progress.message}
               </p>
               
               {/* Progress Stages */}
               <div className="flex justify-between text-xs text-blue-600">
                 <span className={progress.percentage >= 10 ? 'font-semibold' : ''}>Clone</span>
                 <span className={progress.percentage >= 25 ? 'font-semibold' : ''}>Analyze</span>
                 <span className={progress.percentage >= 40 ? 'font-semibold' : ''}>Scan</span>
                 <span className={progress.percentage >= 60 ? 'font-semibold' : ''}>Process</span>
                 <span className={progress.percentage >= 80 ? 'font-semibold' : ''}>Generate</span>
                 <span className={progress.percentage >= 95 ? 'font-semibold' : ''}>Complete</span>
               </div>
             </div>
           )}

          {/* AI Status Display */}
          {aiConfig && (
            <div className="mt-8 p-4 bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg">
              <div className="flex items-center space-x-2 text-purple-800 mb-2">
                <span className="text-sm font-medium">
                  {aiConfig.aiEnabled ? '🤖 AI-Powered Generation' : '⚠️ AI Generation Disabled'}
                </span>
              </div>
              <div className="text-sm text-purple-700">
                {aiConfig.aiEnabled ? (
                  <div>
                    <p>✅ Using Gemini AI for intelligent README generation</p>
                    <p className="text-xs mt-1">Model: {aiConfig.model} | Temperature: {aiConfig.temperature}</p>
                  </div>
                ) : (
                  <div>
                    <p>Using template-based generation. Add GEMINI_API_KEY to enable AI.</p>
                    <a 
                      href="https://makersuite.google.com/app/apikey" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-purple-600 hover:text-purple-800 underline text-xs"
                    >
                      Get Gemini API Key
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Features Section */}
      <section className="py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">
            Why Choose GitGen?
          </h2>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Built for developers, by developers. Get professional-grade documentation 
            without the hassle.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <div key={index} className="text-center">
                <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Icon className="w-8 h-8 text-primary-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  {feature.title}
                </h3>
                <p className="text-gray-600">
                  {feature.description}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Supported Languages */}
      <section className="py-16 bg-white rounded-2xl">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">
            Supports All Major Languages
          </h2>
          <p className="text-xl text-gray-600">
            From JavaScript to Rust, we've got you covered.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 max-w-4xl mx-auto">
          {supportedLanguages.map((language, index) => (
            <div
              key={index}
              className="bg-gray-50 rounded-lg p-4 text-center hover:bg-primary-50 transition-colors duration-200"
            >
              <span className="text-sm font-medium text-gray-700">{language}</span>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">
            How It Works
          </h2>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Three simple steps to beautiful documentation
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
          <div className="text-center">
            <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl font-bold text-primary-600">
              1
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Connect Repository
            </h3>
            <p className="text-gray-600">
              Provide your Git repository URL and project details
            </p>
          </div>

                     <div className="text-center">
             <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl font-bold text-primary-600">
               2
             </div>
             <h3 className="text-lg font-semibold text-gray-900 mb-2">
               Code Analysis
             </h3>
             <p className="text-gray-600">
               Our system analyzes your code structure, functions, and dependencies
             </p>
           </div>

                     <div className="text-center">
             <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl font-bold text-primary-600">
               3
             </div>
             <h3 className="text-lg font-semibold text-gray-900 mb-2">
               New README Generated
             </h3>
             <p className="text-gray-600">
               Get a professional README file ready to use in your repository
             </p>
           </div>
        </div>
      </section>
    </div>
  );
};

export default Home;