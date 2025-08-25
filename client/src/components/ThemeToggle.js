import React, { useState, useEffect } from 'react';
import { Sun, Moon } from 'lucide-react';

const ThemeToggle = () => {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    // Check for saved theme preference or default to dark mode
    const savedTheme = localStorage.getItem('theme');
    
    if (savedTheme === 'light') {
      setIsDark(false);
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      // Default to dark mode
      setIsDark(true);
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('theme', 'dark');
    }
  }, []);

  const toggleTheme = () => {
    const newTheme = !isDark;
    setIsDark(newTheme);
    
    if (newTheme) {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
      localStorage.setItem('theme', 'light');
    }
  };

  return (
    <div className="flex items-center space-x-3">
      <Sun className={`w-4 h-4 transition-colors duration-200 ${!isDark ? 'text-yellow-500' : 'text-gray-400'}`} />
      <label className="switch cursor-pointer" title={`Switch to ${isDark ? 'light' : 'dark'} mode`}>
        <input 
          type="checkbox" 
          checked={isDark}
          onChange={toggleTheme}
          className="sr-only"
        />
        <span className="slider"></span>
      </label>
      <Moon className={`w-4 h-4 transition-colors duration-200 ${isDark ? 'text-blue-400' : 'text-gray-400'}`} />
    </div>
  );
};

export default ThemeToggle;
