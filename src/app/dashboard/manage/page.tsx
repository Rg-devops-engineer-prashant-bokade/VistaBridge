// ============================================================================
// Dashboard Manager Page (/dashboard/manage)
//
// Lists all saved interactive dashboards from SQLite:
// - Grid and Table view modes
// - Search filter by dashboard title or description
// - Shows sharing status (PUBLIC or PRIVATE) and creator info
// - Quick actions: Open, Edit layout, Rename, and Delete dashboard
// ============================================================================

'use client';

import Link from 'next/link';
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Table,
  Tag,
  Space,
  Typography,
  Input,
  Segmented,
  Card,
  Button,
  Tooltip,
  App,
  Select,
  DatePicker,
  Empty,
  Spin,
  Modal,
  Form,
  Radio,
} from 'antd';
import {
  Search,
  Filter,
  RefreshCw,
  LayoutDashboard,
  Plus,
  Trash2,
  Lock,
  Globe,
  Eye,
  Copy,
  Settings,
  X,
} from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuthStore } from '@/store/useAuthStore';
import { useUIStore } from '@/store/useUIStore';
import { apiRequest } from '@/lib/api';
import { siteConfig } from '@/config/site-config';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import isBetween from 'dayjs/plugin/isBetween';

dayjs.extend(relativeTime);
dayjs.extend(isBetween);

const { Title, Text } = Typography;

interface Dashboard {
  id: string;
  name: string;
  description?: string;
  is_public?: boolean;
  content: { widgets?: Array<{ type?: string; [key: string]: unknown }> };
  created_at?: string;
  updated_at?: string;
}

export default function ManageDashboardsPage() {
  const router = useRouter();
  const { notification, modal } = App.useApp();
  const { token, hydrated } = useAuthStore();
  const { globalSearch, setGlobalSearch } = useUIStore();
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [activeShare, setActiveShare] = useState<string>('ALL');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [pageSize, setPageSize] = useState(8);
  const [currentPage, setCurrentPage] = useState(1);

  // Filter States
  const [shareFilter, setShareFilter] = useState<string | null>(null);
  const [beforeDate, setBeforeDate] = useState<dayjs.Dayjs | null>(null);
  const [afterDate, setAfterDate] = useState<dayjs.Dayjs | null>(null);
  const [localSearch, setLocalSearch] = useState('');

  // Edit Settings Modal States
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingDashboard, setEditingDashboard] = useState<Dashboard | null>(null);
  const [editName, setEditName] = useState('');
  const [editVisibility, setEditVisibility] = useState<'PUBLIC' | 'PRIVATE'>('PRIVATE');
  const [savingSettings, setSavingSettings] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm] = Form.useForm();

  // ── Fetch Dashboards ───────────────────────────────────────────────────────

  const fetchDashboards = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await apiRequest('/dashboards');
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      setDashboards(Array.isArray(data) ? data : data.results ?? []);
    } catch (err: unknown) {
      if (!silent) {
        const msg = err instanceof Error ? err.message : 'Could not load dashboards.';
        notification.error({
          message: 'Error',
          description: msg,
          placement: 'topRight',
        });
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [notification]);

  useEffect(() => {
    if (token) {
      let isSubscribed = true;
      const load = async () => {
        try {
          const res = await apiRequest('/dashboards');
          const data = await res.json();
          if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
          if (isSubscribed) {
            setDashboards(Array.isArray(data) ? data : data.results ?? []);
          }
        } catch (err: unknown) {
          if (isSubscribed) {
            const msg = err instanceof Error ? err.message : 'Could not load dashboards.';
            notification.error({
              message: 'Error',
              description: msg,
              placement: 'topRight',
            });
          }
        } finally {
          if (isSubscribed) setLoading(false);
        }
      };
      void load();
      return () => {
        isSubscribed = false;
      };
    }
  }, [token, notification]);

  // Redirect guest users
  useEffect(() => {
    if (hydrated && !token) {
      router.replace('/login');
    }
  }, [hydrated, token, router]);

  // ── Filtering Logic ────────────────────────────────────────────────────────

  const filteredDashboards = useMemo(() => {
    let filtered = [...dashboards];

    // 1. Filter by Segmented Tab (ALL, PUBLIC, PRIVATE)
    if (activeShare === 'PUBLIC') {
      filtered = filtered.filter(d => d.is_public);
    } else if (activeShare === 'PRIVATE') {
      filtered = filtered.filter(d => !d.is_public);
    }

    // 2. Filter by global navbar search
    if (globalSearch) {
      const lowerSearch = globalSearch.trim().toLowerCase();
      if (lowerSearch) {
        filtered = filtered.filter(d =>
          d.name.toLowerCase().includes(lowerSearch) ||
          String(d.id).includes(lowerSearch) ||
          (d.description && d.description.toLowerCase().includes(lowerSearch))
        );
      }
    }

    // 3. Filter by local search input
    if (localSearch) {
      const lowerSearch = localSearch.trim().toLowerCase();
      if (lowerSearch) {
        filtered = filtered.filter(d =>
          d.name.toLowerCase().includes(lowerSearch) ||
          String(d.id).includes(lowerSearch) ||
          (d.description && d.description.toLowerCase().includes(lowerSearch))
        );
      }
    }

    // 4. Filter by Share dropdown in Advanced Filter
    if (shareFilter) {
      if (shareFilter === 'PUBLIC') filtered = filtered.filter(d => d.is_public);
      if (shareFilter === 'PRIVATE') filtered = filtered.filter(d => !d.is_public);
    }

    // 5. Filter by Created After Date
    if (afterDate) {
      filtered = filtered.filter(d => {
        const date = d.created_at || d.updated_at;
        return date ? (dayjs(date).isAfter(afterDate, 'day') || dayjs(date).isSame(afterDate, 'day')) : false;
      });
    }

    // 6. Filter by Created Before Date
    if (beforeDate) {
      filtered = filtered.filter(d => {
        const date = d.created_at || d.updated_at;
        return date ? (dayjs(date).isBefore(beforeDate, 'day') || dayjs(date).isSame(beforeDate, 'day')) : false;
      });
    }

    return filtered;
  }, [dashboards, activeShare, globalSearch, localSearch, shareFilter, afterDate, beforeDate]);

  const resetFilters = () => {
    setShareFilter(null);
    setBeforeDate(null);
    setAfterDate(null);
    setGlobalSearch('');
    setLocalSearch('');
  };

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleDelete = (id: string, name: string) => {
    modal.confirm({
      title: 'Delete Dashboard',
      content: `Are you sure you want to delete the dashboard "${name}"? This action cannot be undone.`,
      okText: 'Delete Dashboard',
      okType: 'danger',
      cancelText: 'Cancel',
      async onOk() {
        try {
          const res = await apiRequest(`/dashboards/${id}`, { method: 'DELETE' });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `HTTP ${res.status}`);
          }
          notification.success({
            message: 'Dashboard Deleted',
            description: `Successfully removed dashboard "${name}".`,
            placement: 'topRight',
          });
          setSelectedRowKeys(prev => prev.filter(k => k !== id));
          fetchDashboards(true);
        } catch (err: any) {
          notification.error({
            message: 'Error',
            description: err.message || 'Could not delete dashboard.',
            placement: 'topRight',
          });
        }
      }
    });
  };

  const handleBulkDelete = () => {
    modal.confirm({
      title: 'Bulk Delete Dashboards',
      content: `Are you sure you want to delete ${selectedRowKeys.length} selected dashboards? This action cannot be undone.`,
      okText: 'Delete All',
      okType: 'danger',
      cancelText: 'Cancel',
      async onOk() {
        try {
          for (const key of selectedRowKeys) {
            await apiRequest(`/dashboards/${String(key)}`, { method: 'DELETE' });
          }
          notification.success({
            message: 'Dashboards Deleted',
            description: `Successfully removed ${selectedRowKeys.length} dashboards.`,
            placement: 'topRight',
          });
          setSelectedRowKeys([]);
          fetchDashboards(true);
        } catch (err: any) {
          notification.error({
            message: 'Error',
            description: err.message || 'An error occurred during bulk deletion.',
            placement: 'topRight',
          });
        }
      }
    });
  };

  const handleClone = async (dashboard: Dashboard) => {
    try {
      const payload = {
        name: `${dashboard.name} (Copy)`,
        description: dashboard.description || '',
        is_public: dashboard.is_public || false,
        content: dashboard.content || { widgets: [] },
      };
      const res = await apiRequest('/dashboards', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const cloned = await res.json();
      if (!res.ok) throw new Error(cloned.detail || `HTTP ${res.status}`);
      notification.success({
        message: 'Dashboard Cloned',
        description: `Created clone "${cloned.name}"`,
        placement: 'topRight',
      });
      fetchDashboards(true);
    } catch (err: any) {
      notification.error({
        message: 'Error',
        description: err.message || 'Failed to clone dashboard.',
        placement: 'topRight',
      });
    }
  };

  const openEditVisibility = (dashboard: Dashboard) => {
    setEditingDashboard(dashboard);
    setEditName(dashboard.name);
    setEditVisibility(dashboard.is_public ? 'PUBLIC' : 'PRIVATE');
    setEditModalOpen(true);
  };

  const handleSaveVisibility = async () => {
    if (!editingDashboard) return;
    const trimmedName = editName.trim();
    if (!trimmedName || trimmedName.length < 2) {
      notification.warning({
        message: 'Invalid Name',
        description: 'Dashboard name must be at least 2 characters long.',
        placement: 'topRight',
      });
      return;
    }
    if (trimmedName.length > 32) {
      notification.warning({
        message: 'Invalid Name',
        description: 'Dashboard name cannot exceed 32 characters.',
        placement: 'topRight',
      });
      return;
    }
    if (/[<>]/.test(trimmedName)) {
      notification.warning({
        message: 'Invalid Name',
        description: 'Dashboard name cannot contain < or > characters.',
        placement: 'topRight',
      });
      return;
    }

    setSavingSettings(true);
    try {
      const res = await apiRequest(`/dashboards/${editingDashboard.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: trimmedName,
          is_public: editVisibility === 'PUBLIC',
        }),
      });
      const updated = await res.json();
      if (!res.ok) throw new Error(updated.detail || `HTTP ${res.status}`);

      setDashboards((prev) =>
        prev.map((d) =>
          d.id === editingDashboard.id
            ? { ...d, name: trimmedName, is_public: editVisibility === 'PUBLIC' }
            : d
        )
      );
      notification.success({
        message: 'Settings Saved',
        description: `Dashboard workspace "${trimmedName}" updated successfully.`,
        placement: 'topRight',
      });
      setEditModalOpen(false);
      fetchDashboards(true);
    } catch (err: any) {
      notification.error({
        message: 'Update Failed',
        description: err.message || 'Could not update dashboard settings.',
        placement: 'topRight',
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleCreateDashboard = async (values: { name: string; description?: string; share: string }) => {
    setCreating(true);
    try {
      const payload = {
        name: values.name.trim(),
        description: values.description || '',
        is_public: values.share === 'PUBLIC',
        content: { widgets: [] }
      };
      const res = await apiRequest('/dashboards', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
      if (!data.id) throw new Error('Server did not return a valid dashboard ID');

      notification.success({
        message: 'Dashboard Created',
        description: `Successfully created "${data.name}"`,
        placement: 'topRight',
      });
      setCreateOpen(false);
      createForm.resetFields();
      router.push(`/dashboard/view?id=${data.id}`);
    } catch (err: any) {
      notification.error({
        message: 'Error',
        description: err.message || 'Failed to create dashboard.',
        placement: 'topRight',
      });
    } finally {
      setCreating(false);
    }
  };

  // ── Stats Logic ────────────────────────────────────────────────────────────

  const stats = {
    total: dashboards.length,
    public: dashboards.filter(d => d.is_public).length,
    private: dashboards.filter(d => !d.is_public).length,
  };

  const widgetCount = (d: Dashboard) => d.content?.widgets?.length ?? 0;

  // ── Table Columns ──────────────────────────────────────────────────────────

  const columns = [
    {
      title: 'Dashboard Workspace',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: Dashboard) => (
        <div className="max-w-[320px] whitespace-nowrap">
          <Link
            href={`/dashboard/view?id=${record.id}`}
            className="block text-[14px] font-bold text-gray-800 hover:text-primary transition-colors truncate"
          >
            {text}
          </Link>
        </div>
      ),
      sorter: (a: Dashboard, b: Dashboard) => a.name.localeCompare(b.name),
    },
    {
      title: 'Widgets',
      key: 'widgets',
      render: (_: any, record: Dashboard) => {
        const count = widgetCount(record);
        const widgetTypes = Array.from(
          new Set((record.content?.widgets ?? []).map((w: any) => w.type ?? 'widget'))
        );

        return (
          <div className="flex items-center gap-1.5 flex-wrap whitespace-nowrap">
            <Tag className="text-[10px] font-bold rounded px-2 py-0.5 border-none bg-gray-100 text-gray-600 m-0">
              {count} {count === 1 ? 'Widget' : 'Widgets'}
            </Tag>
            {widgetTypes.slice(0, 2).map((type) => (
              <Tag
                key={type as string}
                className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border-none m-0"
              >
                {type as string}
              </Tag>
            ))}
            {widgetTypes.length > 2 && (
              <span className="text-[10px] text-gray-400 font-bold">+{widgetTypes.length - 2}</span>
            )}
          </div>
        );
      },
    },
    {
      title: 'Visibility',
      dataIndex: 'is_public',
      key: 'visibility',
      render: (isPublic: boolean) => (
        <div className="flex items-center gap-1.5 whitespace-nowrap">
          {!isPublic ? (
            <Lock size={12} className="text-orange-400" />
          ) : (
            <Globe size={12} className="text-green-400" />
          )}
          <Text className={`text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${!isPublic ? 'text-orange-500' : 'text-green-500'}`}>
            {isPublic ? 'PUBLIC' : 'PRIVATE'}
          </Text>
        </div>
      ),
    },
    {
      title: 'Updated',
      key: 'updated',
      render: (_: any, record: Dashboard) => {
        const date = record.updated_at || record.created_at;
        return (
          <Tooltip title={date ? dayjs(date).format('YYYY-MM-DD HH:mm:ss') : 'No date'}>
            <Text className="text-[12px] text-gray-400 font-medium whitespace-nowrap">
              {date ? dayjs(date).fromNow() : 'N/A'}
            </Text>
          </Tooltip>
        );
      },
      sorter: (a: Dashboard, b: Dashboard) => {
        const dateA = a.updated_at || a.created_at || '';
        const dateB = b.updated_at || b.created_at || '';
        return dayjs(dateA).unix() - dayjs(dateB).unix();
      },
    },
    {
      title: '',
      key: 'actions',
      render: (_: any, record: Dashboard) => (
        <Space size="middle" className="whitespace-nowrap">
          <Tooltip title="Open Dashboard">
            <Link href={`/dashboard/view?id=${record.id}`}>
              <Button type="text" size="small" icon={<Eye size={16} className="text-gray-400 hover:text-primary" />} />
            </Link>
          </Tooltip>

          <Tooltip title="Dashboard Settings">
            <Button
              type="text"
              size="small"
              icon={<Settings size={16} className="text-gray-400 hover:text-primary" />}
              onClick={() => openEditVisibility(record)}
            />
          </Tooltip>

          <Tooltip title="Clone">
            <Button
              type="text"
              size="small"
              icon={<Copy size={15} className="text-gray-400 hover:text-primary" />}
              onClick={() => handleClone(record)}
            />
          </Tooltip>

          <Tooltip title="Delete Dashboard">
            <Button
              type="text"
              size="small"
              danger
              icon={<Trash2 size={16} />}
              onClick={() => handleDelete(record.id, record.name)}
            />
          </Tooltip>
        </Space>
      ),
      width: 140,
    },
  ];

  const onSelectChange = (newSelectedRowKeys: React.Key[]) => {
    setSelectedRowKeys(newSelectedRowKeys);
  };

  const rowSelection = {
    selectedRowKeys,
    onChange: onSelectChange,
  };

  if (!hydrated || !token) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <Spin size="large" description="Establishing secure session..." />
      </div>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-[1.5rem] animate-in fade-in slide-in-from-bottom-[1rem] duration-700 pb-[5rem]">
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-[1rem]">
          <div>
            <div className="flex items-center gap-[0.75rem] mb-[0.25rem]">
              <Title level={2} className="!m-0 !text-[1.125rem] sm:!text-[1.375rem] md:!text-[1.625rem]">Dashboard Workspaces</Title>
            </div>
            <Text type="secondary" className="text-[0.75rem] sm:text-[0.875rem]">Manage, layout, and preview analytical dashboard workspaces.</Text>
          </div>
          <div className="flex items-center gap-[0.5rem]">
            <Button
              type="primary"
              icon={<Plus size={16} />}
              onClick={() => {
                createForm.setFieldsValue({ name: '', description: '', share: 'PRIVATE' });
                setCreateOpen(true);
              }}
              className="rounded-[0.75rem] h-[2.5rem] px-[1.5rem] font-bold shadow-md hover:shadow-lg transition-all text-[0.75rem] sm:text-[0.875rem] flex items-center gap-1.5"
            >
              Create Dashboard
            </Button>
            <Button
              icon={<RefreshCw size={16} className={loading ? 'animate-spin' : ''} />}
              onClick={() => fetchDashboards()}
              className="rounded-[0.75rem] h-[2.5rem] px-[1rem] font-medium bg-white border-gray-200 shadow-sm hover:shadow-md transition-all text-[0.75rem] sm:text-[0.875rem]"
            >
              Refresh
            </Button>
          </div>
        </div>

        {/* Dashboard Stats Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-[0.75rem] sm:gap-[1rem]">
          {[
            { label: 'Total Dashboards', value: stats.total, icon: <LayoutDashboard size={isMobile ? 16 : 20} />, color: 'bg-primary' },
            { label: 'Public Dashboards', value: stats.public, icon: <Globe size={isMobile ? 16 : 20} />, color: 'bg-green-500' },
            { label: 'Private Dashboards', value: stats.private, icon: <Lock size={isMobile ? 16 : 20} />, color: 'bg-orange-500' },
          ].map((stat, i) => (
            <Card key={i} variant="borderless" className="shadow-sm border border-gray-100 rounded-[1rem] overflow-hidden group hover:shadow-md transition-all" styles={{ body: { padding: isMobile ? '0.625rem 0.875rem' : '1.5rem' } }}>
              <div className="flex items-center gap-[0.75rem] sm:gap-[1rem]">
                <div className={`${stat.color} p-[0.5rem] sm:p-[0.75rem] rounded-[0.75rem] text-white shadow-sm group-hover:scale-110 transition-transform mb-auto mt-[0.125rem] flex shrink-0`}>
                  {stat.icon}
                </div>
                <div>
                  <Text className="text-[0.5625rem] xs:text-[0.625rem] sm:text-[0.75rem] font-bold uppercase tracking-widest text-gray-400 block leading-none mb-[0.25rem]">{stat.label}</Text>
                  <Title level={3} className="!m-0 !text-[1rem] sm:!text-[1.25rem] md:!text-[1.5rem] font-black">{stat.value}</Title>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Main Content Table Card */}
        <Card variant="borderless" className="shadow-sm rounded-[1.5rem] border border-gray-100 overflow-hidden bg-white" styles={{ body: { padding: isMobile ? '0.75rem' : '1.5rem' } }}>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-[1rem] mb-[1rem] px-[0.5rem] pt-[0.5rem]">
            <Segmented
              size="large"
              options={[
                {
                  label: (
                    <div className="flex items-center gap-[0.5rem] px-[0.25rem]">
                      <LayoutDashboard size={16} />
                      <span className="hidden sm:inline">All Dashboards</span>
                      <span className="sm:hidden">All</span>
                    </div>
                  ),
                  value: 'ALL'
                },
                {
                  label: (
                    <div className="flex items-center gap-[0.5rem] px-[0.25rem] text-green-600">
                      <Globe size={16} />
                      <span className="hidden sm:inline">Public</span>
                      <span className="sm:hidden">Public</span>
                    </div>
                  ),
                  value: 'PUBLIC'
                },
                {
                  label: (
                    <div className="flex items-center gap-[0.5rem] px-[0.25rem] text-orange-500">
                      <Lock size={16} />
                      <span className="hidden sm:inline">Private</span>
                      <span className="sm:hidden">Private</span>
                    </div>
                  ),
                  value: 'PRIVATE'
                },
              ]}
              value={activeShare}
              onChange={(value) => setActiveShare(value as string)}
              className="vismap-segmented p-[0.25rem] rounded-[1rem] bg-gray-50 shrink-0"
            />

            <div className="flex items-center gap-[0.5rem] w-full md:w-auto">
              <Input
                placeholder="Search by name, ID or description..."
                prefix={<Search size={18} className="text-gray-400" />}
                className="vismap-input flex-1 md:w-[18rem] rounded-[0.75rem] border-gray-200 h-[2.5rem] text-[0.75rem] sm:text-[0.875rem]"
                value={localSearch}
                onChange={e => setLocalSearch(e.target.value.replace(/^\s+/, ''))}
                onBlur={() => {
                  if (localSearch) setLocalSearch(localSearch.trim());
                }}
                onPressEnter={() => {
                  if (localSearch) setLocalSearch(localSearch.trim());
                }}
                allowClear
              />
              <Button
                icon={<Filter size={18} />}
                onClick={() => setShowFilters(!showFilters)}
                className={`rounded-[0.75rem] flex items-center justify-center border-gray-200 h-[2.5rem] transition-all text-[0.75rem] sm:text-[0.875rem] ${showFilters ? 'bg-primary text-white border-primary shadow-md' : (shareFilter || beforeDate || afterDate ? 'bg-primary/5 text-primary border-primary/20' : '')}`}
              >
                <span className="hidden xs:inline">{showFilters ? 'Hide' : 'Filter'}</span>
                {(shareFilter || beforeDate || afterDate) && !showFilters && <span className="ml-[0.5rem] w-[0.5rem] h-[0.5rem] bg-primary rounded-full animate-pulse" />}
              </Button>
            </div>
          </div>

          {/* Inline Advanced Filter Panel */}
          {showFilters && (
            <div className="mx-[0.5rem] bg-gray-50/50 rounded-[1rem] p-[1.25rem] mb-[1.5rem] border border-gray-100 animate-in fade-in slide-in-from-top-[0.5rem] duration-300">
              <div className="flex items-center justify-between mb-[1rem]">
                <Text strong className="text-gray-700 flex items-center gap-[0.5rem]">
                  <Filter size={14} /> Advanced Filters
                </Text>
                <Button type="link" size="small" onClick={resetFilters} className="text-primary font-bold p-0">Clear All Filters</Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-[1rem]">
                <div>
                  <Text className="text-[0.6875rem] font-bold uppercase tracking-widest text-gray-400 mb-[0.375rem] block">Visibility</Text>
                  <Select
                    className="w-full h-[2.5rem]"
                    placeholder="Any Visibility"
                    allowClear
                    value={shareFilter}
                    onChange={setShareFilter}
                    options={[
                      { label: 'Private', value: 'PRIVATE' },
                      { label: 'Public', value: 'PUBLIC' }
                    ]}
                  />
                </div>

                <div>
                  <Text className="text-[0.6875rem] font-bold uppercase tracking-widest text-gray-400 mb-[0.375rem] block">Created After</Text>
                  <DatePicker
                    className="w-full h-[2.5rem]"
                    placeholder="Start Date"
                    value={afterDate}
                    allowClear={!isMobile}
                    onChange={(date) => {
                      setAfterDate(date);
                      if (date && beforeDate && date.isAfter(beforeDate, 'day')) {
                        setBeforeDate(null);
                      }
                    }}
                    disabledDate={(current) => {
                      if (!beforeDate || !current) return false;
                      return current.isAfter(beforeDate, 'day');
                    }}
                  />
                </div>

                <div>
                  <Text className="text-[0.6875rem] font-bold uppercase tracking-widest text-gray-400 mb-[0.375rem] block">Created Before</Text>
                  <DatePicker
                    className="w-full h-[2.5rem]"
                    placeholder="End Date"
                    value={beforeDate}
                    allowClear={!isMobile}
                    onChange={(date) => {
                      setBeforeDate(date);
                      if (date && afterDate && date.isBefore(afterDate, 'day')) {
                        setAfterDate(null);
                      }
                    }}
                    disabledDate={(current) => {
                      if (!afterDate || !current) return false;
                      return current.isBefore(afterDate, 'day');
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Table View */}
          <Table
            rowSelection={rowSelection}
            columns={columns}
            dataSource={filteredDashboards}
            loading={loading}
            rowKey="id"
            className="vismap-table"
            scroll={{ x: 800 }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    <div className="flex flex-col items-center gap-[0.5rem]">
                      <Text type="secondary" className="font-medium">No dashboard workspaces found matching your criteria</Text>
                      {shareFilter || beforeDate || afterDate || globalSearch !== '' || localSearch !== '' ? (
                        <Button type="link" onClick={resetFilters}>Clear all filters</Button>
                      ) : (
                        <Button
                          type="link"
                          className="font-bold"
                          onClick={() => {
                            createForm.setFieldsValue({ name: '', description: '', share: 'PRIVATE' });
                            setCreateOpen(true);
                          }}
                        >
                          Create your first dashboard
                        </Button>
                      )}
                    </div>
                  }
                />
              )
            }}
            pagination={{
              current: currentPage,
              pageSize: pageSize,
              showSizeChanger: true,
              pageSizeOptions: ['5', '8', '10', '15'],
              onChange: (page, size) => {
                setCurrentPage(page);
                setPageSize(size);
              },
              className: 'mt-[1.5rem] px-[1rem] pb-[1rem]',
            }}
          />
        </Card>

        {/* Floating Bulk Action Bar */}
        {selectedRowKeys.length > 0 && (
          <div
            className="fixed bottom-[1.5rem] left-1/2 -translate-x-1/2 z-[100] text-white px-[1.5rem] py-[0.75rem] rounded-[1rem] shadow-2xl flex items-center gap-[1.5rem] animate-in fade-in slide-in-from-bottom-[1rem] duration-500 border border-white/10"
            style={{ backgroundColor: siteConfig.colors.secondary }}
          >
            <div className="flex items-center gap-[0.75rem] pr-[1.5rem] border-r border-white/10">
              <div className="bg-primary p-[0.375rem] rounded-[0.5rem] text-white flex shrink-0">
                <LayoutDashboard size={16} />
              </div>
              <span className="text-white font-bold whitespace-nowrap">{selectedRowKeys.length} Selected</span>
            </div>

            <div className="flex items-center gap-[1rem]">
              <Button
                danger
                type="primary"
                icon={<Trash2 size={16} />}
                onClick={handleBulkDelete}
                className="rounded-[0.75rem] font-bold px-[1.5rem] h-[2.25rem] flex items-center shadow-lg"
              >
                Delete Dashboards
              </Button>
            </div>

            <Button
              type="text"
              icon={<X size={16} className="text-white" />}
              onClick={() => setSelectedRowKeys([])}
              className="!text-white hover:!bg-white/10 ml-[0.5rem] p-[0.25rem] h-auto flex items-center"
            />
          </div>
        )}
      </div>

      {/* Dashboard Settings Modal */}
      <Modal
        title={
          <div className="flex items-center gap-2.5 border-b border-gray-100 pb-3">
            <div className="p-1.5 rounded-lg bg-blue-50 text-primary">
              <Settings size={18} />
            </div>
            <span className="font-bold text-gray-800 text-base">Dashboard Settings</span>
          </div>
        }
        open={editModalOpen}
        onCancel={() => !savingSettings && setEditModalOpen(false)}
        footer={[
          <Button
            key="cancel"
            onClick={() => setEditModalOpen(false)}
            disabled={savingSettings}
            className="rounded-xl font-medium"
          >
            Cancel
          </Button>,
          <Button
            key="save"
            type="primary"
            loading={savingSettings}
            onClick={handleSaveVisibility}
            className="bg-primary hover:bg-primary/90 border-none rounded-xl font-bold px-5"
          >
            Save Changes
          </Button>
        ]}
        width={480}
        centered
        className="rounded-2xl"
      >
        <div className="py-3 flex flex-col gap-4">
          <div>
            <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
              Dashboard Name
            </div>
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Enter dashboard workspace name"
              maxLength={32}
              className="rounded-xl h-10 bg-gray-50/80 border-gray-200 font-medium text-sm focus:bg-white"
            />
            {editingDashboard && (
              <div className="text-[11px] text-gray-400 font-mono mt-1.5 px-1 truncate">
                ID: {editingDashboard.id}
              </div>
            )}
          </div>

          <div>
            <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2.5">
              Select Visibility
            </div>
            <Radio.Group
              value={editVisibility}
              onChange={(e) => setEditVisibility(e.target.value)}
              className="w-full flex flex-col gap-2.5"
            >
              <div
                onClick={() => setEditVisibility('PRIVATE')}
                className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-start gap-3 ${
                  editVisibility === 'PRIVATE'
                    ? 'border-orange-400 bg-orange-50/40 shadow-xs'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                <Radio value="PRIVATE" className="mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 font-bold text-sm text-gray-800">
                    <Lock size={14} className="text-orange-500" />
                    <span>Private</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                    Only you can view and access this dashboard workspace (requires logging in).
                  </div>
                </div>
              </div>

              <div
                onClick={() => setEditVisibility('PUBLIC')}
                className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-start gap-3 ${
                  editVisibility === 'PUBLIC'
                    ? 'border-green-400 bg-green-50/40 shadow-xs'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                <Radio value="PUBLIC" className="mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 font-bold text-sm text-gray-800">
                    <Globe size={14} className="text-green-500" />
                    <span>Public</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                    Anyone with the shareable link can view this dashboard workspace without logging in.
                  </div>
                </div>
              </div>
            </Radio.Group>
          </div>
          </div>
        </Modal>

      {/* Create Dashboard Modal */}
      <Modal
        title={
          <div className="flex items-center gap-3 text-gray-800 pr-6">
            <div className="p-3.5 bg-primary/10 text-primary rounded-2xl shrink-0">
              <LayoutDashboard size={22} />
            </div>
            <div>
              <Title level={4} className="!m-0 font-extrabold">Configure Dashboard</Title>
              <Text className="text-gray-400 text-[11px] font-medium block mt-0.5">Define metadata and access levels for your new dashboard workspace</Text>
            </div>
          </div>
        }
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        footer={null}
        destroyOnClose
        centered
        width="min(100% - 32px, 500px)"
        styles={{ body: { padding: '1.5rem 1.5rem 0.5rem 1.5rem' } }}
        className="rounded-[2.5rem] overflow-hidden"
      >
        <Form
          form={createForm}
          layout="vertical"
          onFinish={handleCreateDashboard}
          className="space-y-5"
        >
          <Form.Item
            name="name"
            label={<span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Dashboard Name</span>}
            rules={[
              { required: true, message: 'Please enter a name for your dashboard' },
              {
                validator: (_, value) => {
                  const trimmed = (value || '').trim();
                  if (!trimmed) {
                    return Promise.reject(new Error('Dashboard name cannot be empty or contain only spaces'));
                  }
                  if (trimmed.length < 2) {
                    return Promise.reject(new Error('Dashboard name must be at least 2 characters long'));
                  }
                  if (trimmed.length > 32) {
                    return Promise.reject(new Error('Dashboard name cannot exceed 32 characters'));
                  }
                  if (/[<>]/.test(trimmed)) {
                    return Promise.reject(new Error('Dashboard name contains invalid characters (< or >)'));
                  }
                  return Promise.resolve();
                }
              }
            ]}
          >
            <Input placeholder="e.g. My Dashboard Workspace" className="rounded-xl h-11 bg-gray-50 border-none hover:bg-gray-100/70 focus:bg-white focus:ring-1 focus:ring-primary/20 transition-all font-semibold" maxLength={32} />
          </Form.Item>

          <Form.Item
            name="description"
            label={<span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Description</span>}
          >
            <Input.TextArea placeholder="Describe the focus or theme of this dashboard..." rows={4} className="rounded-xl bg-gray-50 border-none hover:bg-gray-100/70 focus:bg-white focus:ring-1 focus:ring-primary/20 transition-all" />
          </Form.Item>

          <Form.Item
            name="share"
            label={<span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Access Control</span>}
            initialValue="PRIVATE"
            rules={[{ required: true }]}
          >
            <Select
              className="vismap-select h-11"
              options={[
                { label: 'Private', value: 'PRIVATE' },
                { label: 'Public', value: 'PUBLIC' }
              ]}
            />
          </Form.Item>

          <div className="flex gap-3 justify-end pt-5 border-t border-gray-100 mt-8">
            <Button className="rounded-xl h-11 px-6 font-semibold" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={creating}
              className="rounded-xl h-11 px-8 font-bold border-none shadow-md hover:shadow-lg transition-all"
            >
              Create Dashboard
            </Button>
          </div>
        </Form>
      </Modal>
    </DashboardLayout>
  );
}
