import React from 'react';

const MarkdownRenderer = ({ content }) => {
  if (!content) {
    return <div className="text-gray-500 italic">No content to display</div>;
  }

  // Parse markdown and convert to HTML-like structure
  const parseMarkdown = (text) => {
    if (typeof text !== 'string') return text;
    
    // Split content into lines
    const lines = text.split('\n');
    const elements = [];
    let inCodeBlock = false;
    let codeBlockContent = [];
    let inList = false;
    let listItems = [];
    
    lines.forEach((line, index) => {
      const trimmedLine = line.trim();
      
      // Handle code blocks
      if (trimmedLine.startsWith('```')) {
        if (inCodeBlock) {
          // End code block
          elements.push({
            type: 'code',
            content: codeBlockContent.join('\n'),
            language: codeBlockContent[0]?.includes('language:') ? 
              codeBlockContent[0].split('language:')[1]?.trim() : ''
          });
          codeBlockContent = [];
          inCodeBlock = false;
        } else {
          // Start code block
          inCodeBlock = true;
          codeBlockContent = [];
        }
        return;
      }
      
      if (inCodeBlock) {
        codeBlockContent.push(line);
        return;
      }
      
      // Handle headers
      if (trimmedLine.startsWith('#')) {
        const level = trimmedLine.match(/^#+/)[0].length;
        const text = trimmedLine.replace(/^#+\s*/, '');
        elements.push({
          type: `h${level}`,
          content: text
        });
        return;
      }
      
      // Handle unordered lists
      if (trimmedLine.match(/^[\-\*\+]\s/)) {
        if (!inList) {
          inList = true;
          listItems = [];
        }
        listItems.push(trimmedLine.replace(/^[\-\*\+]\s/, ''));
        return;
      }
      
      // Handle ordered lists (numbered lists)
      if (trimmedLine.match(/^\d+\.\s/)) {
        if (!inList) {
          inList = true;
          listItems = [];
        }
        listItems.push(trimmedLine.replace(/^\d+\.\s/, ''));
        return;
      }
      
      // End list when empty line or different content
      if (inList && trimmedLine === '') {
        // End list - determine if it's ordered or unordered
        const isOrdered = listItems.some(item => /^\d+\.\s/.test(item));
        elements.push({
          type: isOrdered ? 'ol' : 'ul',
          items: listItems
        });
        inList = false;
        listItems = [];
        return;
      } else if (inList) {
        // Continue list
        listItems.push(trimmedLine);
        return;
      }
      
      // Handle task lists (GitHub checkboxes)
      if (trimmedLine.match(/^[\-\*\+]\s\[[\sxX]\]\s/)) {
        const checkboxMatch = trimmedLine.match(/^[\-\*\+]\s\[([\sxX])\]\s(.+)/);
        if (checkboxMatch) {
          const isChecked = checkboxMatch[1].toLowerCase() === 'x';
          const text = checkboxMatch[2];
          elements.push({
            type: 'checkbox',
            checked: isChecked,
            content: text
          });
          return;
        }
      }
      
      // Handle bold and italic
      if (trimmedLine.includes('**') || trimmedLine.includes('*')) {
        let processedLine = trimmedLine;
        // Bold
        processedLine = processedLine.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        // Italic
        processedLine = processedLine.replace(/\*(.*?)\*/g, '<em>$1</em>');
        // Inline code
        processedLine = processedLine.replace(/`(.*?)`/g, '<code class="inline-code">$1</code>');
        
        if (processedLine !== trimmedLine) {
          elements.push({
            type: 'p',
            content: processedLine
          });
          return;
        }
      }
      
      // Handle inline code
      if (trimmedLine.includes('`')) {
        const processedLine = trimmedLine.replace(/`(.*?)`/g, '<code class="inline-code">$1</code>');
        elements.push({
          type: 'p',
          content: processedLine
        });
        return;
      }
      
      // Handle links
      if (trimmedLine.includes('[') && trimmedLine.includes('](')) {
        const linkMatch = trimmedLine.match(/\[([^\]]+)\]\(([^)]+)\)/);
        if (linkMatch) {
          const text = linkMatch[1];
          const url = linkMatch[2];
          const processedLine = trimmedLine.replace(/\[([^\]]+)\]\(([^)]+)\)/g, 
            `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:text-blue-800 underline">${text}</a>`);
          elements.push({
            type: 'p',
            content: processedLine
          });
          return;
        }
      }
      
      // Handle horizontal rules
      if (trimmedLine.match(/^[\-\*_]{3,}$/)) {
        elements.push({
          type: 'hr'
        });
        return;
      }
      
      // Handle tables
      if (trimmedLine.includes('|') && trimmedLine.trim().startsWith('|') && trimmedLine.trim().endsWith('|')) {
        if (!elements.some(el => el.type === 'table')) {
          // Start new table
          elements.push({
            type: 'table',
            headers: [],
            rows: []
          });
        }
        
        const table = elements.find(el => el.type === 'table');
        const cells = trimmedLine.split('|').filter(cell => cell.trim() !== '');
        
        if (table.headers.length === 0) {
          // This is the header row
          table.headers = cells.map(cell => cell.trim());
        } else if (trimmedLine.match(/^\|[\s\-\|:]+\|$/)) {
          // This is the separator row, skip it
          return;
        } else {
          // This is a data row
          table.rows.push(cells.map(cell => cell.trim()));
        }
        return;
      }
      
      // Handle blockquotes
      if (trimmedLine.startsWith('>')) {
        const quoteContent = trimmedLine.replace(/^>\s*/, '');
        elements.push({
          type: 'blockquote',
          content: quoteContent
        });
        return;
      }
      
      // Handle empty lines
      if (trimmedLine === '') {
        elements.push({
          type: 'br'
        });
        return;
      }
      
      // Regular paragraph
      if (trimmedLine) {
        elements.push({
          type: 'p',
          content: trimmedLine
        });
      }
    });
    
    // Handle any remaining list
    if (inList && listItems.length > 0) {
      const isOrdered = listItems.some(item => /^\d+\.\s/.test(item));
      elements.push({
        type: isOrdered ? 'ol' : 'ul',
        items: listItems
      });
    }
    
    return elements;
  };

  const renderElement = (element, index) => {
    switch (element.type) {
      case 'h1':
        return (
          <h1 key={index} className="text-4xl font-bold text-gray-900 border-b border-gray-200 pb-2 mb-6">
            {element.content}
          </h1>
        );
      case 'h2':
        return (
          <h2 key={index} className="text-3xl font-bold text-gray-900 border-b border-gray-200 pb-2 mb-5 mt-8">
            {element.content}
          </h2>
        );
      case 'h3':
        return (
          <h3 key={index} className="text-2xl font-semibold text-gray-900 mb-4 mt-6">
            {element.content}
          </h3>
        );
      case 'h4':
        return (
          <h4 key={index} className="text-xl font-semibold text-gray-900 mb-3 mt-5">
            {element.content}
          </h4>
        );
      case 'h5':
        return (
          <h5 key={index} className="text-lg font-semibold text-gray-900 mb-2 mt-4">
            {element.content}
          </h5>
        );
      case 'h6':
        return (
          <h6 key={index} className="text-base font-semibold text-gray-900 mb-2 mt-4">
            {element.content}
          </h6>
        );
      case 'p':
        return (
          <p key={index} 
             className="text-gray-700 leading-relaxed mb-4"
             dangerouslySetInnerHTML={{ __html: element.content }}
          />
        );
      case 'ul':
        return (
          <ul key={index} className="list-disc list-inside mb-4 space-y-1">
            {element.items.map((item, itemIndex) => (
              <li key={itemIndex} className="text-gray-700 ml-4">
                {item}
              </li>
            ))}
          </ul>
        );
      case 'ol':
        return (
          <ol key={index} className="list-decimal list-inside mb-4 space-y-1">
            {element.items.map((item, itemIndex) => (
              <li key={itemIndex} className="text-gray-700 ml-4">
                {item}
              </li>
            ))}
          </ol>
        );
      case 'code':
        return (
          <div key={index} className="mb-4">
            {element.language && (
              <div className="bg-gray-800 text-gray-200 px-3 py-1 text-sm font-mono rounded-t">
                {element.language}
              </div>
            )}
            <pre className="bg-gray-900 text-gray-100 p-4 rounded-b overflow-x-auto">
              <code className="text-sm font-mono whitespace-pre">
                {element.content}
              </code>
            </pre>
          </div>
        );
      case 'hr':
        return (
          <hr key={index} className="border-gray-300 my-6" />
        );
      case 'br':
        return <div key={index} className="h-4" />;
      case 'checkbox':
        return (
          <div key={index} className="flex items-center space-x-2 mb-2">
            <input
              type="checkbox"
              checked={element.checked}
              readOnly
              className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
            />
            <span className="text-gray-700">{element.content}</span>
          </div>
        );
      case 'table':
        return (
          <div key={index} className="overflow-x-auto mb-4">
            <table className="min-w-full border border-gray-300 rounded-lg">
              <thead>
                <tr className="bg-gray-50">
                  {element.headers.map((header, headerIndex) => (
                    <th key={headerIndex} className="border border-gray-300 px-3 py-2 text-left font-semibold text-gray-900">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {element.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className={rowIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className="border border-gray-300 px-3 py-2 text-gray-700">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'blockquote':
        return (
          <blockquote key={index} className="border-l-4 border-gray-300 pl-4 italic text-gray-600 my-4 bg-gray-50 py-2 rounded-r">
            {element.content}
          </blockquote>
        );
      default:
        return (
          <p key={index} className="text-gray-700 mb-4">
            {element.content}
          </p>
        );
    }
  };

  const parsedElements = parseMarkdown(content);

  return (
    <div className="markdown-content prose prose-lg max-w-none">
      {parsedElements.map((element, index) => renderElement(element, index))}
      
      {/* Fallback for unparsed content */}
      {parsedElements.length === 0 && (
        <div className="whitespace-pre-wrap text-gray-700 font-mono text-sm bg-gray-50 p-4 rounded border">
          {content}
        </div>
      )}
    </div>
  );
};

export default MarkdownRenderer;
