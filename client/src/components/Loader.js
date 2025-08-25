import React from 'react';

const Loader = ({ size = 'default', className = '' }) => {
  const sizeClasses = {
    small: 'w-16 h-16',
    default: 'w-24 h-24',
    large: 'w-32 h-32',
    xl: 'w-40 h-40'
  };

  const sizeClass = sizeClasses[size] || sizeClasses.default;

  return (
    <div className={`loader ${sizeClass} ${className}`}>
      <div className="loader_cube loader_cube--color"></div>
      <div className="loader_cube loader_cube--glowing"></div>
    </div>
  );
};

export default Loader;
