import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@sentinel/ui/tokens.css';
import { Shop } from './Shop.js';

const root = document.getElementById('root');
if (!root) throw new Error('root element missing');

createRoot(root).render(
  <StrictMode>
    <Shop />
  </StrictMode>,
);
