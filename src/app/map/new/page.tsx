// ============================================================================
// Create New Map Workspace Page (/map/new)
//
// Workspace creation wizard:
// - Start from a blank map or choose from domain templates (Urban Planning,
//   Environmental, Transport)
// - Configures initial map title, description, basemap, and default center/zoom
// - Saves the new record in SQLite and redirects into the 2D interactive editor
// ============================================================================

'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import { Spin, Typography, Card, Button, Tag, Modal, Input, Select, Form, App } from 'antd';
import {
  Map as MapIcon,
  ArrowRight,
  Compass,
} from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useUIStore } from '@/store/useUIStore';
import { useAppearanceStore } from '@/store/useAppearanceStore';
import { apiRequest } from '@/lib/api';

const { Title, Text, Paragraph } = Typography;

interface WorkspaceTemplate {
  title: string;
  subtitle: string;
  description: string;
  gradient: string;
  accentBg: string;
  accentText: string;
  shadowColor: string;
  icon: React.ReactNode;
  link: string;
  features: string[];
}

export default function NewMapPage() {
  const { notification } = App.useApp();
  const router = useRouter();
  const { user, token, hydrated } = useAuthStore();
  const { setCreateMapModalOpen } = useUIStore();

  // Modal Form States
  const [formOpen, setFormOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<WorkspaceTemplate | null>(null);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!hydrated) return;

    if (!token) {
      router.replace('/login');
    } else {
      setCreateMapModalOpen(true);
      router.replace('/map/manage');
    }
  }, [token, router, hydrated, setCreateMapModalOpen]);

  const actuallyLoading = !hydrated || (!user && !!token);

  if (actuallyLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <Spin size="large" description="Establishing secure session..." />
      </div>
    );
  }

  const workspaceOptions = [
    {
      title: "2D Map",
      subtitle: "Planar Geospatial Viewer",
      description: "Visualize, query, and overlay vector datasets and raster layers in a standard 2D flat coordinate layout. Best for standard spatial queries, buffer calculations, and layout drafting.",
      gradient: "from-purple-600 to-indigo-600",
      accentBg: "bg-purple-50",
      accentText: "text-purple-600",
      shadowColor: "shadow-purple-500/10",
      icon: <MapIcon size={32} />,
      link: "/map/2d",
      features: ["MVT Vector Tiles", "GeoTIFF Rasters", "Measurement tools"]
    }
  ];

  const handleLaunchClick = (template: WorkspaceTemplate) => {
    setSelectedTemplate(template);
    form.setFieldsValue({
      name: '',
      description: '',
      share: 'PRIVATE'
    });
    setFormOpen(true);
  };

  const handleSaveMap = async (values: {
    name?: string;
    description?: string;
    share?: 'PRIVATE' | 'INTERNAL' | 'PUBLIC';
  }) => {
    const trimmedName = (values.name || '').trim();
    if (!trimmedName || trimmedName.length < 2) return;

    setSaving(true);
    try {
      const mapType = '2D';
      const appState = useAppearanceStore.getState();

      const response = await apiRequest('/maps/', {
        method: 'POST',
        body: JSON.stringify({
          name: trimmedName,
          description: (values.description || '').trim(),
          share: values.share,
          type: mapType,
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
      setFormOpen(false);

      // Redirect to the created workspace view: e.g. /map/2d?id=uuid
      // Using window.location.href ensures a fresh lifecycle without stale map/layer state across browsers
      window.location.href = `${selectedTemplate?.link || '/map/2d'}?id=${mapData.id}`;
    } catch (err: unknown) {
      notification.error({
        message: 'Error',
        description: (err as Error).message || 'Failed to create map workspace.',
        placement: 'topRight'
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-12">
        {/* Header Block */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-primary text-xs font-bold uppercase tracking-wider mb-1">
            <Compass size={14} className="animate-spin-slow" />
            <span>Workspace Setup</span>
          </div>
          <Title level={2} className="!m-0">Create New Map</Title>
          <Paragraph className="text-gray-500 text-sm max-w-xl">
            Select a visualization configuration template to launch your GIS canvas. You can load both vector and raster datasets inside your workspace.
          </Paragraph>
        </div>

        {/* Option Grid */}
        <div className="grid grid-cols-1 max-w-lg mx-auto gap-8">
          {workspaceOptions.map((opt, idx) => (
            <Card
              key={idx}
              variant="borderless"
              className={`relative overflow-hidden shadow-lg hover:shadow-xl ${opt.shadowColor} rounded-[2.5rem] border border-gray-100 hover:border-gray-200 transition-all duration-300 transform hover:-translate-y-2 group flex flex-col h-full bg-white`}
              styles={{ body: { padding: '2.5rem', display: 'flex', flexDirection: 'column', flexGrow: 1 } }}
            >
              {/* Upper Background Glow */}
              <div className={`absolute top-0 right-0 w-36 h-36 bg-gradient-to-br ${opt.gradient} opacity-5 blur-2xl rounded-full transition-transform group-hover:scale-150 duration-500`} />

              {/* Icon & Subtitle Header */}
              <div className="flex items-center justify-between mb-8">
                <div className={`w-16 h-16 ${opt.accentBg} ${opt.accentText} rounded-3xl flex items-center justify-center transition-transform group-hover:scale-110 duration-300`}>
                  {opt.icon}
                </div>
                <Tag className="border-none rounded-full font-bold text-[10px] uppercase px-2.5 py-0.5 bg-gray-50 text-gray-400">
                  Ready
                </Tag>
              </div>

              {/* Details */}
              <div className="flex-1 flex flex-col justify-between">
                <div>
                  <Title level={3} className="!m-0 !mb-1 text-gray-800 font-extrabold tracking-tight">
                    {opt.title}
                  </Title>
                  <Text className={`text-xs font-bold tracking-wide uppercase ${opt.accentText} block mb-4`}>
                    {opt.subtitle}
                  </Text>
                  <Paragraph className="text-gray-500 text-xs leading-relaxed mb-6">
                    {opt.description}
                  </Paragraph>

                  {/* Features List */}
                  <div className="space-y-2 mb-8 border-t border-gray-50 pt-4">
                    {opt.features.map((feat, fIdx) => (
                      <div key={fIdx} className="flex items-center gap-2 text-gray-400 text-xs">
                        <div className="w-1.5 h-1.5 rounded-full bg-gray-300" />
                        <span>{feat}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Launch Button */}
                <Button
                  type="primary"
                  size="large"
                  onClick={() => handleLaunchClick(opt)}
                  className={`w-full bg-gradient-to-r ${opt.gradient} border-none rounded-2xl h-12 flex items-center justify-center gap-2 font-bold shadow-md hover:shadow-lg transition-all`}
                >
                  <span>Launch Map</span>
                  <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Configuration Modal */}
      <Modal
        title={
          <div className="flex items-center gap-3 text-gray-800 pr-6">
            <div className={`p-3.5 ${selectedTemplate?.accentBg} ${selectedTemplate?.accentText} rounded-2xl shrink-0`}>
              {selectedTemplate?.icon}
            </div>
            <div>
              <Title level={4} className="!m-0 font-extrabold">Configure {selectedTemplate?.title}</Title>
              <Text className="text-gray-400 text-[11px] font-medium block mt-0.5">Define metadata and access levels for your new map workspace</Text>
            </div>
          </div>
        }
        open={formOpen}
        onCancel={() => setFormOpen(false)}
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
                    return Promise.reject(new Error('Map name cannot exceed 32 characters'));
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
            <Button className="rounded-xl h-11 px-6 font-semibold" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={saving}
              className={`rounded-xl h-11 px-8 font-bold bg-gradient-to-r ${selectedTemplate?.gradient} border-none shadow-md hover:shadow-lg transition-all`}
            >
              Create Map
            </Button>
          </div>
        </Form>
      </Modal>
    </DashboardLayout>
  );
}
