import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BookOpen, GitBranch, Menu, X, TestTube, FileText } from 'lucide-react';
import { useState } from 'react';
import ThemeToggle from './ThemeToggle';

const Header = () => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const location = useLocation();

  const navigation = [
            { name: 'Home', href: '/', icon: BookOpen },
        { name: 'Projects', href: '/projects', icon: GitBranch },
        { name: 'Debug', href: '/debug', icon: TestTube },
        { name: 'Markdown Demo', href: '/markdown-demo', icon: FileText },
  ];

  const isActive = (path) => location.pathname === path;

  return (
    <header className="shadow-sm border-b transition-colors duration-300" style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
      <div className="container mx-auto px-4">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-primary-700 rounded-lg flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold transition-colors duration-300" style={{ color: 'var(--text-primary)' }}>GitGen</span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-8">
            <nav className="flex space-x-8">
              {navigation.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.name}
                    to={item.href}
                                                         className={`flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-colors duration-200 ${
                     isActive(item.href)
                       ? 'text-primary-600 bg-primary-50'
                       : 'hover:text-primary-600'
                   }`}
                  style={{ 
                    color: isActive(item.href) ? undefined : 'var(--text-secondary)',
                    backgroundColor: isActive(item.href) ? undefined : 'transparent'
                  }}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.name}</span>
                  </Link>
                );
              })}
            </nav>
            
            {/* Theme Toggle */}
            <ThemeToggle />
          </div>

          {/* Mobile menu button */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="md:hidden p-2 rounded-md hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors duration-300"
            style={{ 
              color: 'var(--text-secondary)',
              backgroundColor: 'transparent'
            }}
          >
            {isMobileMenuOpen ? (
              <X className="w-6 h-6" />
            ) : (
              <Menu className="w-6 h-6" />
            )}
          </button>
        </div>

        {/* Mobile Navigation */}
        {isMobileMenuOpen && (
          <div className="md:hidden">
            <div className="px-2 pt-2 pb-3 space-y-1 border-t transition-colors duration-300" style={{ borderColor: 'var(--border-color)' }}>
              {navigation.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.name}
                    to={item.href}
                                         className={`flex items-center space-x-2 px-3 py-2 rounded-md text-base font-medium transition-colors duration-200 ${
                       isActive(item.href)
                         ? 'text-primary-600 bg-primary-50'
                         : 'hover:text-primary-600'
                     }`}
                    style={{ 
                      color: isActive(item.href) ? undefined : 'var(--text-secondary)',
                      backgroundColor: isActive(item.href) ? undefined : 'transparent'
                    }}
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.name}</span>
                  </Link>
                );
              })}
              
                             {/* Mobile Theme Toggle */}
               <div className="px-3 py-2">
                 <div className="flex items-center justify-between">
                   <span className="text-base font-medium transition-colors duration-300" style={{ color: 'var(--text-secondary)' }}>Theme</span>
                   <ThemeToggle />
                 </div>
               </div>
            </div>
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;