import React from 'react';
import MarkdownRenderer from './MarkdownRenderer';

const MarkdownDemo = () => {
  const sampleMarkdown = `# Sample README

This is a **bold** example of a README file with various markdown features.

## Features

- **Unordered list item 1**
- *Italic list item 2*
- \`Inline code\` in list
- [Link to GitHub](https://github.com)

## Installation

1. Clone the repository
2. Install dependencies with \`npm install\`
3. Run the application

## Code Example

\`\`\`javascript
function hello() {
  console.log("Hello, World!");
}
\`\`\`

## Task List

- [x] Completed task
- [ ] Pending task
- [x] Another completed task

## Table Example

| Feature | Status | Notes |
|---------|--------|-------|
| Markdown | ✅ | Fully supported |
| Tables | ✅ | Responsive design |
| Code blocks | ✅ | Syntax highlighting |

## Blockquote

> This is a blockquote example that shows how quoted text appears.

## Horizontal Rule

---

*This README demonstrates the full capabilities of our custom markdown renderer.*`;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Markdown Renderer Demo</h1>
      
      <div className="grid md:grid-cols-2 gap-8">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Raw Markdown</h2>
          <pre className="bg-gray-100 p-4 rounded-lg text-sm overflow-x-auto">
            {sampleMarkdown}
          </pre>
        </div>
        
        <div>
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Rendered Output</h2>
          <div className="border rounded-lg p-6 bg-white">
            <MarkdownRenderer content={sampleMarkdown} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default MarkdownDemo;
