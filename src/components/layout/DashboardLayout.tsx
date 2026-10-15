// ============================================================================
// DashboardLayout Component (Application Shell & Navigation)
//
// Wraps all authenticated pages with a unified app frame:
// 1. Collapsible sidebar navigation (Home, Maps, Dashboards, Layers, Settings)
// 2. Responsive mobile sidebar / drawer toggle
// 3. User profile avatar menu (Password change, Appearance, Logout)
// 4. Custom site branding, theme colors, and logo from SQLite settings
// ============================================================================

/* eslint-disable @next/next/no-img-element */
'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Layout, Menu as AntMenu, Input, Button, Typography, Divider, notification, Form, Modal, Select, type InputRef } from 'antd';
import {
  Map as MapIcon,
  User as UserIcon,
  LogOut,
  Plus,
  Settings,
  Search,
  ChevronLeft,
  ChevronRight,
  UserCircle,
  LayoutDashboard,
  Home,
  Palette
} from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import { useUIStore } from '@/store/useUIStore';
import { useAppearanceStore } from '@/store/useAppearanceStore';
import { siteConfig } from '@/config/site-config';
import { apiRequest } from '@/lib/api';

const { Header, Sider, Content } = Layout;
const { Text, Title } = Typography;

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [openKeys, setOpenKeys] = useState<string[]>([]);

  useEffect(() => {
    let prevMobile = window.innerWidth < 1024;

    // Set initial states based on viewport width on mount
    queueMicrotask(() => {
      setIsMobile(prevMobile);
      setCollapsed(prevMobile);
      setMounted(true);
    });

    const handleResize = () => {
      const currentMobile = window.innerWidth < 1024;
      setIsMobile(currentMobile);

      // Auto toggle collapse only if boundary is crossed
      if (currentMobile !== prevMobile) {
        setCollapsed(currentMobile);
        prevMobile = currentMobile;
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (mounted) {
      queueMicrotask(() => {
        if (collapsed) {
          setOpenKeys([]);
        } else {
          setOpenKeys(['dashboards', 'map', 'accounts']);
        }
      });
    }
  }, [collapsed, mounted]);

  const router = useRouter();
  const pathname = usePathname();
  const { user, clearAuth } = useAuthStore();
  const { customLogo, productName, fetchAppearance } = useAppearanceStore();

  useEffect(() => {
    fetchAppearance(user?.geoserverUrl);
  }, [user?.geoserverUrl, fetchAppearance]);
  const {
    createMapModalOpen,
    setCreateMapModalOpen,
    createDashboardModalOpen,
    setCreateDashboardModalOpen,
    globalSearch,
    setGlobalSearch
  } = useUIStore();
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [dashboardForm] = Form.useForm();
  const [savingDashboard, setSavingDashboard] = useState(false);
  const [hideSubmenu, setHideSubmenu] = useState(false);

  useEffect(() => {
    if (createMapModalOpen || createDashboardModalOpen) {
      queueMicrotask(() => {
        setHideSubmenu(true);
      });
    } else {
      const timer = setTimeout(() => {
        setHideSubmenu(false);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [createMapModalOpen, createDashboardModalOpen]);

  const inputRef = useRef<InputRef>(null);

  useEffect(() => {
    if (globalSearch && inputRef.current) {
      const timer = setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus({
            cursor: 'end',
          });
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [pathname, mounted, globalSearch]);

  interface CreateMapFormValues {
    name: string;
    description?: string;
    share?: string;
  }

  const handleSaveMap = async (values: CreateMapFormValues) => {
    const trimmedName = (values.name || '').trim();
    if (!trimmedName || trimmedName.length < 2) return;

    setSaving(true);
    try {
      const appState = useAppearanceStore.getState();
      const response = await apiRequest('/maps/', {
        method: 'POST',
        body: JSON.stringify({
          name: trimmedName,
          description: (values.description || '').trim(),
          share: values.share,
          type: '2D',
          center_lat: typeof appState.defaultLatitude === 'number' ? appState.defaultLatitude : 20.5937,
          center_lon: typeof appState.defaultLongitude === 'number' ? appState.defaultLongitude : 78.9629,
          zoom: typeof appState.defaultZoom === 'number' ? appState.defaultZoom : 4,
          basemap_id: appState.defaultBasemap || 'osm',
        })
      });

      if (!response.ok) {
        throw new Error('Failed to create map workspace');
      }

      const mapData = await response.json();
      notification.success({
        message: 'Success',
        description: 'Map workspace created successfully.',
        placement: 'topRight'
      });
      setCreateMapModalOpen(false);
      form.resetFields();

      // Redirect to the created workspace view: e.g. /map/2d?id=uuid
      router.push(`/map/2d?id=${mapData.id}`);
    } catch (err: unknown) {
      notification.error({
        message: 'Error',
        description: (err as Error).message || 'Could not create map workspace.',
        placement: 'topRight'
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setCreateMapModalOpen(false);
    form.resetFields();
  };

  interface CreateDashboardFormValues {
    name: string;
    description?: string;
    share?: string;
  }

  const handleSaveDashboard = async (values: CreateDashboardFormValues) => {
    const trimmedName = (values.name || '').trim();
    if (!trimmedName || trimmedName.length < 2) return;

    setSavingDashboard(true);
    try {
      const response = await apiRequest('/dashboards', {
        method: 'POST',
        body: JSON.stringify({
          name: trimmedName,
          description: (values.description || '').trim(),
          is_public: values.share === 'PUBLIC',
          content: { widgets: [] }
        })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to create dashboard');
      }

      const data = await response.json();
      notification.success({
        message: 'Success',
        description: `Dashboard "${data.name}" created successfully.`,
        placement: 'topRight'
      });
      setCreateDashboardModalOpen(false);
      dashboardForm.resetFields();

      router.push(`/dashboard/view?id=${data.id}`);
    } catch (err: unknown) {
      notification.error({
        message: 'Error',
        description: (err as Error).message || 'Could not create dashboard.',
        placement: 'topRight'
      });
    } finally {
      setSavingDashboard(false);
    }
  };

  const handleCancelDashboard = () => {
    setCreateDashboardModalOpen(false);
    dashboardForm.resetFields();
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Failed to log out from server:', err);
    }
    // Defer the redirect slightly so the browser pointer event cycles (down/up/capture) 
    // finish before the DOM element is unmounted, avoiding browser pointer-capture errors.
    setTimeout(() => {
      clearAuth();
      router.push('/login');
    }, 50);
  };

  const menuItems = [
    {
      key: '/overview',
      label: 'Overview',
      icon: <Home size={20} />,
    },
    {
      key: 'dashboards',
      label: 'Dashboards',
      icon: <LayoutDashboard size={20} />,
      children: [
        { key: '/dashboard/new', label: 'Create New Dashboard', icon: <Plus size={16} /> },
        { key: '/dashboard/manage', label: 'Manage Dashboards', icon: <Settings size={16} /> },
      ],
    },
    {
      key: 'map',
      label: 'Map',
      icon: <MapIcon size={20} />,
      children: [
        { key: '/map/new', label: 'Create New Map', icon: <Plus size={16} /> },
        { key: '/map/manage', label: 'Manage Maps', icon: <Settings size={16} /> },
      ],
    },
    {
      key: 'accounts',
      label: 'Account Settings',
      icon: <UserCircle size={20} />,
      children: [
        { key: '/accounts/profile', label: 'Update Profile', icon: <UserIcon size={16} /> },
        ...(user?.role === 'ADMIN' || user?.username === 'admin'
          ? [{ key: '/accounts/appearance', label: 'Appearance', icon: <Palette size={16} /> }]
          : []),
      ],
    },
  ];

  return (
    <Layout className="h-screen h-[100dvh] overflow-hidden">
      {/* Horizontal Navbar */}
      <Header
        className="px-6 flex items-center justify-between border-b border-gray-100 sticky top-0 z-50 h-16 shadow-sm shrink-0"
        style={{ background: '#fff', padding: '0 24px', display: 'flex', alignItems: 'center', lineHeight: 'normal' }}
      >
        <div className="flex items-center gap-4 shrink-0 h-full">
          <div
            onClick={() => router.push('/overview')}
            className="flex items-center gap-2.5 sm:gap-3 min-w-fit h-full cursor-pointer hover:opacity-85 transition-opacity py-2"
          >
            {/* Primary Logo (VistaBridge) */}
            {siteConfig.logo && (
              <img src={siteConfig.logo} alt="VistaBridge Logo" className="h-8 w-auto object-contain flex shrink-0" />
            )}

            {/* Custom Product Logo (shown next to the VistaBridge logo if present) */}
            {customLogo && (
              <>
                <div className="h-5 w-[1px] bg-gray-200" />
                <img
                  src={customLogo}
                  alt="Custom Product Logo"
                  className="h-8 max-w-[110px] object-contain flex shrink-0 rounded"
                />
              </>
            )}

            {/* Product / Company Name Header Typography */}
            {productName?.trim() ? (
              <div className="flex flex-col justify-center">
                <span className="text-sm sm:text-base font-black tracking-tight text-gray-900 leading-tight">
                  {productName.trim()}
                </span>
                <span className="text-[10px] sm:text-[11px] font-semibold text-gray-400 leading-tight tracking-wider uppercase">
                  {siteConfig.name}
                </span>
              </div>
            ) : (
              <span className="text-sm sm:text-base font-bold tracking-tight text-gray-800 whitespace-nowrap leading-none">
                {siteConfig.name}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 sm:gap-4 flex-1 justify-end">
          <div className="w-full max-w-[200px] xs:max-w-[240px] sm:max-w-md">
            <Input
              ref={inputRef}
              prefix={<Search size={18} className="text-gray-400" />}
              placeholder="Search workspaces & dashboards..."
              className="vismap-input border-none bg-gray-50 hover:bg-gray-100 focus:bg-white transition-all rounded-full text-xs sm:text-sm h-10 px-4"
              value={globalSearch}
              onChange={(e) => {
                const val = e.target.value.replace(/^\s+/, '');
                setGlobalSearch(val);
                if (pathname !== '/map/manage' && pathname !== '/dashboard/manage') {
                  router.push('/map/manage');
                }
              }}
              onBlur={() => {
                if (globalSearch) {
                  setGlobalSearch(globalSearch.trim());
                }
              }}
              onPressEnter={() => {
                if (globalSearch) {
                  setGlobalSearch(globalSearch.trim());
                }
              }}
              allowClear
            />
          </div>
        </div>
      </Header>

      <Layout className="overflow-hidden relative">
        {/* Mobile Sidebar backdrop overlay */}
        {isMobile && !collapsed && (
          <div
            className="absolute inset-0 bg-black/40 z-45 transition-opacity duration-300 cursor-pointer"
            onClick={() => setCollapsed(true)}
          />
        )}

        {/* Expandable Vertical Sidebar (Overlay on mobile when expanded, inline on desktop/collapsed) */}
        <Sider
          width={260}
          collapsedWidth={64}
          trigger={null}
          collapsible
          collapsed={collapsed}
          className={`${isMobile
              ? `absolute z-50 top-0 left-0 h-full border-r border-gray-100 bg-white ${collapsed ? '' : 'shadow-2xl'
              }`
              : 'bg-white border-r border-gray-100 h-full overflow-visible shrink-0 relative'
            }`}
          style={{
            backgroundColor: 'color-mix(in srgb, var(--primary-color) 2%, white)',
            borderColor: 'color-mix(in srgb, var(--primary-color) 10%, transparent)',
            transition: !mounted ? 'none' : undefined,
            position: isMobile ? 'absolute' : undefined,
            zIndex: isMobile ? 50 : undefined,
            height: isMobile ? '100%' : undefined,
            left: isMobile ? 0 : undefined,
            top: isMobile ? 0 : undefined,
          }}
          theme="light"
        >
          {/* Floating Border Toggle */}
          <div className="absolute -right-3 top-6 z-50">
            <Button
              size="small"
              shape="circle"
              icon={collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
              onClick={() => setCollapsed(!collapsed)}
              className="flex items-center justify-center bg-white border border-gray-200 shadow-sm text-gray-400 hover:text-primary transition-all hover:scale-110"
              style={{ width: 24, height: 24 }}
            />
          </div>

          <div className="flex flex-col h-full justify-between py-4">
            <div className="overflow-y-auto flex-1">
              <AntMenu
                key={createMapModalOpen || createDashboardModalOpen ? 'menu-modal-open' : 'menu-modal-closed'}
                mode="inline"
                selectedKeys={[pathname]}
                openKeys={openKeys}
                onOpenChange={(keys) => setOpenKeys(keys)}
                items={menuItems}
                style={{ background: 'transparent' }}
                className="border-none px-2"
                inlineIndent={16}
                onClick={({ key }) => {
                  if (isMobile) {
                    setCollapsed(true);
                  }
                  if (key === '/map/new') {
                    setCreateMapModalOpen(true);
                    return;
                  }
                  if (key === '/dashboard/new') {
                    setCreateDashboardModalOpen(true);
                    return;
                  }
                  router.push(key);
                }}
              />
            </div>

            <div className="px-4 pb-4 shrink-0">
              <Divider className="my-4 border-gray-100" />

              {/* Logout Button */}
              <Button
                type="primary"
                block
                icon={<LogOut size={18} />}
                onClick={() => {
                  if (isMobile) {
                    setCollapsed(true);
                  }
                  handleLogout();
                }}
                className="flex items-center justify-center gap-3 h-11 rounded-xl transition-all shadow-md hover:shadow-lg font-bold border-none"
                style={{ backgroundColor: siteConfig.colors.secondary }}
              >
                {!collapsed && <span>Sign Out</span>}
              </Button>
            </div>
          </div>
        </Sider>

        {/* Mobile layout spacer to prevent overview section from sliding when sidebar overlays */}
        {isMobile && (
          <div className="w-[64px] shrink-0" />
        )}

        {/* Main Content Area */}
        <Content
          className="bg-[#f8fafc] p-4 sm:p-6 lg:p-8 transition-all duration-200 overflow-y-auto"
        >
          <div className="max-w-7xl mx-auto min-h-full flex flex-col justify-between">
            <div className="w-full flex-grow">
              {children}
            </div>
          </div>
        </Content>
      </Layout>

      {(createMapModalOpen || createDashboardModalOpen || hideSubmenu || !collapsed) && (
        <style>{`
          .ant-menu-submenu-popup {
            display: none !important;
          }
        `}</style>
      )}

      {/* Global Create Map Modal */}
      <Modal
        transitionName=""
        maskTransitionName=""
        title={
          <div className="flex items-center gap-3 text-gray-800 pr-6">
            <div className="p-3.5 bg-purple-50 text-purple-600 rounded-2xl shrink-0">
              <MapIcon size={32} />
            </div>
            <div>
              <Title level={4} className="!m-0 font-extrabold text-gray-800">Configure 2D Map</Title>
              <Text className="text-gray-400 text-[11px] font-medium block mt-0.5">Define metadata and access levels for your new map workspace</Text>
            </div>
          </div>
        }
        open={createMapModalOpen}
        onCancel={handleCancel}
        footer={null}
        destroyOnHidden
        centered
        width="min(100% - 32px, 500px)"
        styles={{ body: { padding: '1.5rem 1.5rem 0.5rem 1.5rem' } }}
        className="rounded-[2.5rem] overflow-hidden"
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSaveMap}
          className="space-y-5"
        >
          <Form.Item
            name="name"
            label={<span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Map Name</span>}
            rules={[
              { required: true, message: 'Please enter a name for your map' },
              {
                validator: (_, value) => {
                  const trimmed = (value || '').trim();
                  if (!trimmed) {
                    return Promise.reject(new Error('Map name cannot be empty or contain only spaces'));
                  }
                  if (trimmed.length < 2) {
                    return Promise.reject(new Error('Map name must be at least 2 characters long'));
                  }
                  if (trimmed.length > 32) {
                    return Promise.reject(new Error('Name cannot exceed 32 characters'));
                  }
                  if (/[<>]/.test(trimmed)) {
                    return Promise.reject(new Error('Map name contains invalid characters (< or >)'));
                  }
                  return Promise.resolve();
                }
              }
            ]}
          >
            <Input maxLength={32} placeholder="e.g. San Francisco Roads Plan" className="rounded-xl h-11 bg-gray-50 border-none hover:bg-gray-100/70 focus:bg-white focus:ring-1 focus:ring-primary/20 transition-all font-semibold" />
          </Form.Item>

          <Form.Item
            name="description"
            label={<span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Description</span>}
          >
            <Input.TextArea placeholder="Describe the focus or theme of this workspace..." rows={4} className="rounded-xl bg-gray-50 border-none hover:bg-gray-100/70 focus:bg-white focus:ring-1 focus:ring-primary/20 transition-all" />
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
            <Button className="rounded-xl h-11 px-6 font-semibold" onClick={handleCancel}>
              Cancel
            </Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={saving}
              className="rounded-xl h-11 px-8 font-bold shadow-md hover:shadow-lg transition-all border-none"
            >
              Create Map
            </Button>
          </div>
        </Form>
      </Modal>

      {/* Global Create Dashboard Modal */}
      <Modal
        transitionName=""
        maskTransitionName=""
        title={
          <div className="flex items-center gap-3 text-gray-800 pr-6">
            <div className="p-3.5 bg-blue-50 text-blue-600 rounded-2xl shrink-0">
              <LayoutDashboard size={32} />
            </div>
            <div>
              <Title level={4} className="!m-0 font-extrabold text-gray-800">Create Dashboard</Title>
              <Text className="text-gray-400 text-[11px] font-medium block mt-0.5">Define name and access level for your new dashboard</Text>
            </div>
          </div>
        }
        open={createDashboardModalOpen}
        onCancel={handleCancelDashboard}
        footer={null}
        destroyOnHidden
        centered
        width="min(100% - 32px, 500px)"
        styles={{ body: { padding: '1.5rem 1.5rem 0.5rem 1.5rem' } }}
        className="rounded-[2.5rem] overflow-hidden"
      >
        <Form
          form={dashboardForm}
          layout="vertical"
          onFinish={handleSaveDashboard}
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
                  if (trimmed.length > 64) {
                    return Promise.reject(new Error('Name cannot exceed 64 characters'));
                  }
                  if (/[<>]/.test(trimmed)) {
                    return Promise.reject(new Error('Dashboard name contains invalid characters (< or >)'));
                  }
                  return Promise.resolve();
                }
              }
            ]}
          >
            <Input maxLength={64} placeholder="e.g. Urban Analytics Overview" className="rounded-xl h-11 bg-gray-50 border-none hover:bg-gray-100/70 focus:bg-white focus:ring-1 focus:ring-primary/20 transition-all font-semibold" />
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
            <Button className="rounded-xl h-11 px-6 font-semibold" onClick={handleCancelDashboard}>
              Cancel
            </Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={savingDashboard}
              className="rounded-xl h-11 px-8 font-bold shadow-md hover:shadow-lg transition-all border-none"
            >
              Create Dashboard
            </Button>
          </div>
        </Form>
      </Modal>
    </Layout>
  );
}

