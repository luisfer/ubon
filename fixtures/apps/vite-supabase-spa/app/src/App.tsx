import { BrowserRouter, Route, Routes } from 'react-router-dom';
import Assistant from './pages/Assistant';
import Index from './pages/Index';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/assistant" element={<Assistant />} />
      </Routes>
    </BrowserRouter>
  );
}
