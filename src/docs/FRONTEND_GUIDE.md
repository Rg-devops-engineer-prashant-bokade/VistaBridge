# Frontend Development Quick Reference

Quick reference for common patterns and best practices in the VistaBridge frontend.

---

## Table of Contents
- [API Requests](#api-requests)
- [State Management](#state-management)
- [Form Handling](#form-handling)
- [File Uploads](#file-uploads)
- [Real-time Updates](#real-time-updates)
- [Error Handling](#error-handling)
- [TypeScript Patterns](#typescript-patterns)
- [React Patterns](#react-patterns)

---

## API Requests

### Basic GET Request
```typescript
import { apiRequest } from '@/lib/api';

const response = await apiRequest('/api/datasets/');
const data = await response.json();
```

### POST with JSON
```typescript
const response = await apiRequest('/api/datasets/', {
  method: 'POST',
  body: JSON.stringify({ name: 'My Dataset', type: 'vector' })
});
```

### File Upload (FormData)
```typescript
const formData = new FormData();
formData.append('file', file);
formData.append('name', 'My Dataset');

const response = await apiRequest('/api/datasets/upload/', {
  method: 'POST',
  body: formData
});
```

### Unauthenticated Request
```typescript
const response = await apiRequest('/api/public/status/', {
  auth: false
});
```

---

## State Management

### Zustand Store Pattern
```typescript
import { create } from 'zustand';

interface MyStore {
  items: Item[];
  loading: boolean;
  fetchItems: () => Promise<void>;
  addItem: (item: Item) => void;
}

export const useMyStore = create<MyStore>((set, get) => ({
  items: [],
  loading: false,
  
  fetchItems: async () => {
    set({ loading: true });
    const response = await apiRequest('/api/items/');
    const data = await response.json();
    set({ items: data, loading: false });
  },
  
  addItem: (item) => set((state) => ({ 
    items: [...state.items, item] 
  }))
}));
```

### Using Store in Components
```typescript
const { items, loading, fetchItems } = useMyStore();

useEffect(() => {
  fetchItems();
}, []);
```

---

## Form Handling

### React Hook Form with Zod
```typescript
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const schema = z.object({
  name: z.string().min(1, 'Name required'),
  email: z.string().email('Invalid email'),
  type: z.enum(['vector', 'raster'])
});

type FormData = z.infer<typeof schema>;

function MyForm() {
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema)
  });

  const onSubmit = async (data: FormData) => {
    await apiRequest('/api/endpoint/', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register('name')} />
      {errors.name && <span>{errors.name.message}</span>}
      
      <button type="submit">Submit</button>
    </form>
  );
}
```

---

## File Uploads

### Upload with Progress
```typescript
function FileUpload() {
  const [progress, setProgress] = useState(0);

  const handleUpload = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        setProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status === 200) {
        console.log('Upload complete');
      }
    });

    xhr.open('POST', `${siteConfig.api.baseUrl}/api/upload/`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.send(formData);
  };

  return <div>Progress: {progress}%</div>;
}
```

### Drag & Drop
```typescript
function DropZone() {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    // Process files
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={isDragging ? 'border-blue-500' : 'border-gray-300'}
    >
      Drop files here
    </div>
  );
}
```

---

## Real-time Updates

### Polling Pattern
```typescript
function DatasetStatus({ datasetId }: { datasetId: string }) {
  const [status, setStatus] = useState<string>('pending');

  useEffect(() => {
    const poll = async () => {
      const response = await apiRequest(`/api/datasets/${datasetId}/`);
      const data = await response.json();
      setStatus(data.status);
      
      if (data.status !== 'completed' && data.status !== 'failed') {
        setTimeout(poll, 2000); // Poll every 2s
      }
    };

    poll();
  }, [datasetId]);

  return <div>Status: {status}</div>;
}
```

### WebSocket Connection
```typescript
function useWebSocket(url: string) {
  const [data, setData] = useState(null);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    ws.current = new WebSocket(url);
    
    ws.current.onmessage = (event) => {
      setData(JSON.parse(event.data));
    };

    return () => ws.current?.close();
  }, [url]);

  const send = (message: any) => {
    ws.current?.send(JSON.stringify(message));
  };

  return { data, send };
}
```

---

## Error Handling

### Error Boundary
```typescript
import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('Error caught:', error);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || <div>Something went wrong</div>;
    }
    return this.props.children;
  }
}
```

### API Error Handler
```typescript
async function handleApiCall<T>(
  apiCall: () => Promise<Response>
): Promise<T | null> {
  try {
    const response = await apiCall();
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `HTTP ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('API Error:', error);
    toast.error(error instanceof Error ? error.message : 'Request failed');
    return null;
  }
}

// Usage
const data = await handleApiCall<Dataset[]>(
  () => apiRequest('/api/datasets/')
);
```

---

## TypeScript Patterns

### API Response Types
```typescript
// Base types
interface Dataset {
  id: string;
  name: string;
  type: 'vector' | 'raster';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: string;
  updated_at: string;
}

interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// Usage
const response = await apiRequest('/api/datasets/');
const data: PaginatedResponse<Dataset> = await response.json();
```

### Generic Component Props
```typescript
interface ListProps<T> {
  items: T[];
  renderItem: (item: T) => ReactNode;
  keyExtractor: (item: T) => string;
}

function List<T>({ items, renderItem, keyExtractor }: ListProps<T>) {
  return (
    <div>
      {items.map((item) => (
        <div key={keyExtractor(item)}>{renderItem(item)}</div>
      ))}
    </div>
  );
}

// Usage
<List
  items={datasets}
  renderItem={(ds) => <div>{ds.name}</div>}
  keyExtractor={(ds) => ds.id}
/>
```

### Type Guards
```typescript
function isVectorDataset(dataset: Dataset): dataset is VectorDataset {
  return dataset.type === 'vector';
}

// Usage
if (isVectorDataset(dataset)) {
  // dataset is VectorDataset here
  console.log(dataset.geometry_type);
}
```

---

## React Patterns

### Custom Hooks
```typescript
// Fetch hook
function useFetch<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    apiRequest(url)
      .then(res => res.json())
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [url]);

  return { data, loading, error };
}

// Debounce hook
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue;
}
```

### Compound Components
```typescript
interface TabsProps {
  children: ReactNode;
  defaultTab?: string;
}

interface TabsContext {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const TabsContext = createContext<TabsContext | null>(null);

function Tabs({ children, defaultTab = '' }: TabsProps) {
  const [activeTab, setActiveTab] = useState(defaultTab);
  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab }}>
      {children}
    </TabsContext.Provider>
  );
}

Tabs.List = function TabsList({ children }: { children: ReactNode }) {
  return <div className="flex gap-2">{children}</div>;
};

Tabs.Tab = function Tab({ id, children }: { id: string; children: ReactNode }) {
  const ctx = useContext(TabsContext)!;
  return (
    <button
      onClick={() => ctx.setActiveTab(id)}
      className={ctx.activeTab === id ? 'active' : ''}
    >
      {children}
    </button>
  );
};

Tabs.Panel = function TabPanel({ id, children }: { id: string; children: ReactNode }) {
  const ctx = useContext(TabsContext)!;
  return ctx.activeTab === id ? <div>{children}</div> : null;
};

// Usage
<Tabs defaultTab="overview">
  <Tabs.List>
    <Tabs.Tab id="overview">Overview</Tabs.Tab>
    <Tabs.Tab id="data">Data</Tabs.Tab>
  </Tabs.List>
  <Tabs.Panel id="overview">Overview content</Tabs.Panel>
  <Tabs.Panel id="data">Data content</Tabs.Panel>
</Tabs>
```

### Render Props
```typescript
interface MouseTrackerProps {
  children: (position: { x: number; y: number }) => ReactNode;
}

function MouseTracker({ children }: MouseTrackerProps) {
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e: MouseEvent) => {
    setPosition({ x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return <>{children(position)}</>;
}

// Usage
<MouseTracker>
  {({ x, y }) => <div>Mouse at {x}, {y}</div>}
</MouseTracker>
```

---

## Best Practices

### Component Organization
```
src/
├── components/
│   ├── ui/           # Reusable UI components (Button, Input, etc.)
│   ├── features/     # Feature-specific components
│   └── layouts/      # Layout components
├── lib/              # Utilities and helpers
├── hooks/            # Custom hooks
├── store/            # State management
├── types/            # TypeScript types
└── config/           # Configuration files
```

### Performance Tips
- Use `React.memo()` for expensive components
- Use `useMemo()` for expensive calculations
- Use `useCallback()` for stable function references
- Lazy load routes: `const Page = lazy(() => import('./Page'))`
- Virtualize long lists with `react-window`

### Code Style
- Prefer named exports over default exports
- Use functional components with hooks
- Keep components small and focused
- Extract complex logic into custom hooks
- Use TypeScript strict mode
- Validate props with Zod schemas

### Testing Pattern
```typescript
import { render, screen, fireEvent } from '@testing-library/react';

describe('MyComponent', () => {
  it('renders correctly', () => {
    render(<MyComponent />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('handles click', () => {
    const handleClick = jest.fn();
    render(<MyComponent onClick={handleClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalled();
  });
});
```

---

## Quick Snippets

### Conditional Rendering
```typescript
{condition && <Component />}
{condition ? <ComponentA /> : <ComponentB />}
{items.length > 0 ? <List /> : <EmptyState />}
```

### List Rendering
```typescript
{items.map((item) => (
  <Item key={item.id} {...item} />
))}
```

### Event Handlers
```typescript
<button onClick={() => handleClick(id)}>Click</button>
<input onChange={(e) => setValue(e.target.value)} />
<form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
```

### CSS Classes (Tailwind)
```typescript
import { cn } from '@/lib/utils';

<div className={cn(
  'base-class',
  isActive && 'active-class',
  variant === 'primary' && 'primary-class'
)} />
```

---

## Environment Variables

```env
# .env.local
VITE_API_URL=http://localhost:8000
VITE_MINIO_URL=http://localhost:9000
VITE_TILESERV_URL=http://localhost:7800
```

Access in code:
```typescript
const apiUrl = import.meta.env.VITE_API_URL;
```

---

## Troubleshooting

### Common Issues

**CORS errors**: Ensure Django CORS settings allow frontend origin

**401 errors**: Check token refresh logic in `apiRequest`

**Build errors**: Clear cache with `rm -rf node_modules/.vite`

**Type errors**: Run `tsc --noEmit` to check types without building

**Hydration errors**: Ensure server and client render the same content
