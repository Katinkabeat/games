import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { SQErrorBoundary } from '../packages/sq-ui/index.js';
import './index.css';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/games/sw.js').catch((err) => {
    console.warn('SideQuest service worker registration failed:', err);
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SQErrorBoundary label="hub">
      <App />
    </SQErrorBoundary>
  </React.StrictMode>
);
