import React, { useState, useEffect, useCallback } from 'react';
import { Search, Filter, X, FileText, Code, Folder } from 'lucide-react';
import { apiBaseUrl } from '../config';

const SearchComponent = ({ onResultClick }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    language: '',
    fileType: '',
    projectId: ''
  });
  const [stats, setStats] = useState(null);

  // Debounced search
  const debouncedSearch = useCallback(
    debounce(async (searchQuery, searchFilters) => {
      if (!searchQuery || searchQuery.length < 2) {
        setResults([]);
        setStats(null);
        return;
      }

      setLoading(true);
      try {
        const params = new URLSearchParams({
          q: searchQuery,
          ...searchFilters
        });

        const response = await fetch(`${apiBaseUrl}/api/search?${params}`);
        if (response.ok) {
          const data = await response.json();
          setResults(data.results);
          setStats(data.stats);
        }
      } catch (error) {
        console.error('Search failed:', error);
      } finally {
        setLoading(false);
      }
    }, 300),
    []
  );

  // Get search suggestions
  const getSuggestions = useCallback(
    debounce(async (searchQuery) => {
      if (!searchQuery || searchQuery.length < 1) {
        setSuggestions([]);
        return;
      }

      try {
        const response = await fetch(`${apiBaseUrl}/api/search/suggestions?q=${encodeURIComponent(searchQuery)}`);
        if (response.ok) {
          const data = await response.json();
          setSuggestions(data.suggestions);
        }
      } catch (error) {
        console.error('Failed to get suggestions:', error);
      }
    }, 200),
    []
  );

  useEffect(() => {
    debouncedSearch(query, filters);
  }, [query, filters, debouncedSearch]);

  useEffect(() => {
    getSuggestions(query);
  }, [query, getSuggestions]);

  const handleSearch = (e) => {
    e.preventDefault();
    debouncedSearch(query, filters);
  };

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => {
    setFilters({
      language: '',
      fileType: '',
      projectId: ''
    });
  };

  const getFileIcon = (language) => {
    switch (language) {
      case 'javascript':
      case 'typescript':
        return <Code className="w-4 h-4 text-yellow-500" />;
      case 'python':
        return <Code className="w-4 h-4 text-blue-500" />;
      case 'java':
        return <Code className="w-4 h-4 text-orange-500" />;
      case 'css':
        return <Code className="w-4 h-4 text-pink-500" />;
      case 'html':
        return <Code className="w-4 h-4 text-red-500" />;
      default:
        return <FileText className="w-4 h-4 text-gray-500" />;
    }
  };

  const getMatchTypeIcon = (type) => {
    switch (type) {
      case 'path':
        return <Folder className="w-3 h-3 text-blue-500" />;
      case 'function':
        return <Code className="w-3 h-3 text-green-500" />;
      case 'class':
        return <Code className="w-3 h-3 text-purple-500" />;
      case 'content':
        return <FileText className="w-3 h-3 text-gray-500" />;
      default:
        return <FileText className="w-3 h-3 text-gray-400" />;
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto">
      {/* Search Form */}
      <form onSubmit={handleSearch} className="mb-6">
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-gray-400" />
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search across all project documentation..."
            className="block w-full pl-10 pr-12 py-3 border border-gray-300 rounded-lg leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <div className="absolute inset-y-0 right-0 flex items-center">
            <button
              type="button"
              onClick={() => setShowFilters(!showFilters)}
              className="p-2 text-gray-400 hover:text-gray-600"
              title="Toggle filters"
            >
              <Filter className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Search Suggestions */}
        {suggestions.length > 0 && query && (
          <div className="mt-2 flex flex-wrap gap-2">
            {suggestions.slice(0, 8).map((suggestion, index) => (
              <button
                key={index}
                type="button"
                onClick={() => setQuery(suggestion)}
                className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-full transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
      </form>

      {/* Filters */}
      {showFilters && (
        <div className="mb-6 p-4 bg-gray-50 rounded-lg border">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-700">Search Filters</h3>
            <button
              onClick={clearFilters}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Clear all
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Language
              </label>
              <select
                value={filters.language}
                onChange={(e) => handleFilterChange('language', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All languages</option>
                <option value="javascript">JavaScript</option>
                <option value="typescript">TypeScript</option>
                <option value="python">Python</option>
                <option value="java">Java</option>
                <option value="css">CSS</option>
                <option value="html">HTML</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                File Type
              </label>
              <select
                value={filters.fileType}
                onChange={(e) => handleFilterChange('fileType', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All types</option>
                <option value=".js">.js</option>
                <option value=".ts">.ts</option>
                <option value=".py">.py</option>
                <option value=".java">.java</option>
                <option value=".css">.css</option>
                <option value=".html">.html</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Project ID
              </label>
              <input
                type="text"
                value={filters.projectId}
                onChange={(e) => handleFilterChange('projectId', e.target.value)}
                placeholder="Specific project"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* Search Stats */}
      {stats && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center justify-between text-sm text-blue-800">
            <span>
              Found <strong>{stats.totalResults}</strong> results for "{stats.query}"
            </span>
            <span>
              Showing {stats.returnedResults} of {stats.totalResults}
            </span>
          </div>
          <div className="mt-2 text-xs text-blue-700">
            <span className="mr-4">Project: {stats.filters.projectId || 'all'}</span>
            <span className="mr-4">Language: {stats.filters.language || 'all'}</span>
            <span>File Type: {stats.filters.fileType || 'all'}</span>
          </div>
        </div>
      )}

      {/* Search Results */}
      <div className="space-y-4">
        {loading && (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-600">Searching...</p>
          </div>
        )}

        {!loading && results.length === 0 && query && (
          <div className="text-center py-8 text-gray-500">
            <Search className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <p>No results found for "{query}"</p>
            <p className="text-sm mt-2">Try adjusting your search terms or filters</p>
          </div>
        )}

        {results.map((result, index) => (
          <div
            key={`${result.projectId}-${result.file.path}-${index}`}
            className="p-4 border border-gray-200 rounded-lg hover:border-blue-300 hover:shadow-md transition-all cursor-pointer"
            onClick={() => onResultClick && onResultClick(result)}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center space-x-2 mb-2">
                  {getFileIcon(result.file.language)}
                  <span className="font-mono text-sm text-gray-600">
                    {result.file.path}
                  </span>
                  <span className="text-xs text-gray-500">
                    ({result.file.language})
                  </span>
                </div>
                
                <div className="mb-2">
                  <h4 className="font-medium text-gray-900">
                    {result.projectName}
                  </h4>
                  <p className="text-sm text-gray-600">
                    {result.repoUrl.replace(/^https?:\/\//, '').replace(/\.git$/, '')}
                  </p>
                </div>

                {/* Match Details */}
                <div className="space-y-1">
                  {result.matches.map((match, matchIndex) => (
                    <div key={matchIndex} className="flex items-center space-x-2 text-sm">
                      {getMatchTypeIcon(match.type)}
                      <span className="text-gray-600">
                        <strong>{match.type}:</strong> {match.context}
                      </span>
                    </div>
                  ))}
                </div>

                {/* File Info */}
                <div className="mt-3 flex items-center space-x-4 text-xs text-gray-500">
                  <span>{result.file.size ? `${Math.round(result.file.size / 1024)}KB` : 'N/A'}</span>
                  {result.file.functions.length > 0 && (
                    <span>{result.file.functions.length} functions</span>
                  )}
                  {result.file.classes.length > 0 && (
                    <span>{result.file.classes.length} classes</span>
                  )}
                </div>
              </div>

              <div className="ml-4 text-right">
                <div className="text-lg font-bold text-blue-600">
                  {Math.round(result.score)}
                </div>
                <div className="text-xs text-gray-500">relevance</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Debounce utility function
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

export default SearchComponent;