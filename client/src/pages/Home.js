import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useProjects } from '../context/ProjectContext';
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

const Home = () => {
  const { createProject, loading, error, clearError } = useProjects();
  const [formData, setFormData] = useState({
    repoUrl: '',
    projectName: '',
    description: ''
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    clearError();
    
    try {
      const projectId = await createProject(formData);
      // Redirect to project detail page
      window.location.href = `/projects/${projectId}`;
    } catch (error) {
      console.error('Failed to create project:', error);
    }
  };

  const handleInputChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
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
            with just a few clicks. Save hours of manual work and keep your docs always up to date.
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
              Start Your First Project
            </h2>
            <p className="text-gray-600">
              Enter your Git repository URL and we'll generate comprehensive documentation automatically.
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
                Git Repository URL *
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
                Supports GitHub, GitLab, Bitbucket, and other Git hosting services
              </p>
            </div>

            <div>
              <label htmlFor="projectName" className="block text-sm font-medium text-gray-700 mb-2">
                Project Name *
              </label>
              <input
                type="text"
                id="projectName"
                name="projectName"
                value={formData.projectName}
                onChange={handleInputChange}
                placeholder="My Awesome Project"
                className="input-field"
                required
              />
            </div>

            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
                Description (Optional)
              </label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                placeholder="Brief description of your project..."
                rows="3"
                className="input-field"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <div className="flex items-center justify-center space-x-2">
                  <Clock className="w-5 h-5 animate-spin" />
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
        </div>
      </section>

      {/* Features Section */}
      <section className="py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">
            Why Choose DocuFlow?
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
              Automatic Analysis
            </h3>
            <p className="text-gray-600">
              Our AI analyzes your code and generates comprehensive documentation
            </p>
          </div>

          <div className="text-center">
            <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl font-bold text-primary-600">
              3
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Beautiful Docs
            </h3>
            <p className="text-gray-600">
              Get professional documentation ready to share with your team
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Home;