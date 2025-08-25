import React, { useState, useEffect } from 'react';

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
    <label className="switch">
      <input 
        type="checkbox" 
        checked={isDark}
        onChange={toggleTheme}
      />
      <span className="slider"></span>
    </label>
  );
};

export default ThemeToggle;
