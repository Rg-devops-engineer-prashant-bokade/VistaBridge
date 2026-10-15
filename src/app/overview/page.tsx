// ============================================================================
// System Overview Page (/overview)
//
// Administrative dashboard showing connected GIS services:
// - GeoServer connection status & health check
// - Metrics: total workspaces, layers, layer groups, and registered users
// - Quick status cards linking to map workspaces and datasets
// ============================================================================

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import { Spin, Typography, Card } from 'antd';
import { User as UserIcon, Layers, Globe, Layers3 } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';

const { Title, Text } = Typography;

interface WorkspaceItem {
  name: string;
}

interface LayerItem {
  name: string;
  title: string;
}

interface UserItem {
  userName: string;
  enabled?: boolean;
}

interface GeoserverOverviewData {
  geoserverConnected: boolean;
  workspaces: WorkspaceItem[];
  layers: LayerItem[];
  layerGroups: unknown[];
  users: UserItem[];
}

export default function OverviewPage() {
  const router = useRouter();
  const { user, token, hydrated } = useAuthStore();
  const [geoserverData, setGeoserverData] = useState<GeoserverOverviewData | null>(null);
  const [geoserverLoading, setGeoserverLoading] = useState(true);

  // 1. Guard check: redirect guests to login
  useEffect(() => {
    if (hydrated && !token) {
      router.replace('/login');
    }
  }, [hydrated, token, router]);

  // 2. Fetch GeoServer overview data
  useEffect(() => {
    if (!hydrated || !token || !user) return;

    const fetchGeoServerOverview = async () => {
      setGeoserverLoading(true);
      try {
        const geoserverUrl = user.geoserverUrl || (process.env.NEXT_PUBLIC_GEOSERVER_URL || 'http://localhost:8080/geoserver').replace(/\/$/, '');
        const headers: Record<string, string> = {
          'Accept': 'application/json',
        };
        if (user.geoserverAuth) {
          headers['Authorization'] = user.geoserverAuth;
        }

        const isAdmin = user.role === 'ADMIN' || user.username === 'admin';

        let workspacesList: WorkspaceItem[] = [];
        let layersList: LayerItem[] = [];
        let layerGroupsList: unknown[] = [];
        let usersList: UserItem[] = [];
        let geoserverConnected = false;

        if (isAdmin) {
          try {
            const overviewRes = await fetch('/api/geoserver/overview');
            if (overviewRes.ok) {
              const overviewData = await overviewRes.json();
              if (overviewData.geoserverConnected) {
                geoserverConnected = true;
                workspacesList = overviewData.workspaces || [];
                layersList = overviewData.layers || [];
                layerGroupsList = overviewData.layerGroups || [];
                usersList = overviewData.users || [];
              }
            }
          } catch (restErr) {
            console.error('Failed to fetch overview data from /api/geoserver/overview:', restErr);
          }
        }

        if (!geoserverConnected) {
          try {
            const capUrl = `${geoserverUrl}/ows?service=WMS&version=1.3.0&request=GetCapabilities`;
            const capRes = await fetch(capUrl, { headers });
            if (capRes.ok) {
              geoserverConnected = true;
              const xmlText = await capRes.text();
              const parser = new DOMParser();
              const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
              const layerElements = xmlDoc.getElementsByTagName('Layer');

              const workspacesSet = new Set<string>();
              const layers: LayerItem[] = [];

              for (let i = 0; i < layerElements.length; i++) {
                const nameEl = Array.from(layerElements[i].children).find(el => el.tagName === 'Name');
                const titleEl = Array.from(layerElements[i].children).find(el => el.tagName === 'Title');

                if (nameEl && nameEl.textContent) {
                  const fullName = nameEl.textContent.trim();
                  if (fullName.includes(':')) {
                    const [workspaceName, layerName] = fullName.split(':');
                    workspacesSet.add(workspaceName);
                    layers.push({
                      name: fullName,
                      title: titleEl && titleEl.textContent ? titleEl.textContent.trim() : layerName,
                    });
                  }
                }
              }

              workspacesList = Array.from(workspacesSet).map(name => ({ name }));
              layersList = layers;
              layerGroupsList = [];

              if (!isAdmin && user.username) {
                usersList = [{ userName: user.username, enabled: true }];
              } else if (usersList.length === 0) {
                usersList = [{ userName: user.username || 'admin', enabled: true }];
              }
            }
          } catch (capErr) {
            console.error('Failed to parse GetCapabilities XML:', capErr);
          }
        }

        setGeoserverData({
          geoserverConnected,
          workspaces: workspacesList,
          layers: layersList,
          layerGroups: layerGroupsList,
          users: workspacesList.length > 0 ? usersList : [],
        });
      } catch (error) {
        console.error('Failed to fetch GeoServer overview:', error);
      } finally {
        setGeoserverLoading(false);
      }
    };

    fetchGeoServerOverview();
  }, [hydrated, token, user]);

  if (!hydrated || !token) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <Spin size="large" description="Establishing secure session..." />
      </div>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
        {/* Header Section */}
        <div className="flex flex-col gap-1">
          <Title level={2} className="m-0">Overview</Title>
          <Text type="secondary" className="text-base text-gray-500 font-normal">
            Welcome to your spatial data infrastructure workspace.
          </Text>
        </div>

        {/* Stats Grid Cards: Exactly three columns in one line on medium screens and up */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Card 1: Layers */}
          <Card variant="borderless" className="shadow-sm rounded-3xl hover:shadow-md transition-all group bg-white border border-gray-100/55 p-5">
            <div className="flex items-start justify-between">
              <div>
                <Text type="secondary" className="text-xs uppercase font-bold tracking-widest block mb-4 text-gray-400">GeoServer Layers</Text>
                <Title level={1} className="m-0 font-extrabold text-gray-800 leading-none">
                  {geoserverLoading ? <Spin size="small" /> : (geoserverData?.layers?.length || 0)}
                </Title>
              </div>
              <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform shadow-sm">
                <Layers size={24} />
              </div>
            </div>
          </Card>

          {/* Card 2: Workspaces */}
          <Card variant="borderless" className="shadow-sm rounded-3xl hover:shadow-md transition-all group bg-white border border-gray-100/55 p-5">
            <div className="flex items-start justify-between">
              <div>
                <Text type="secondary" className="text-xs uppercase font-bold tracking-widest block mb-4 text-gray-400">GeoServer Workspaces</Text>
                <Title level={1} className="m-0 font-extrabold text-gray-800 leading-none">
                  {geoserverLoading ? <Spin size="small" /> : (geoserverData?.workspaces?.length || 0)}
                </Title>
              </div>
              <div className="w-12 h-12 bg-purple-50 text-purple-600 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform shadow-sm">
                <Globe size={24} />
              </div>
            </div>
          </Card>

          {/* Card 3: Security Users */}
          <Card variant="borderless" className="shadow-sm rounded-3xl hover:shadow-md transition-all group bg-white border border-gray-100/55 p-5">
            <div className="flex items-start justify-between">
              <div>
                <Text type="secondary" className="text-xs uppercase font-bold tracking-widest block mb-4 text-gray-400">Security Users</Text>
                <Title level={1} className="m-0 font-extrabold text-gray-800 leading-none">
                  {geoserverLoading ? <Spin size="small" /> : (geoserverData?.users?.length || 0)}
                </Title>
              </div>
              <div className="w-12 h-12 bg-orange-50 text-orange-600 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform shadow-sm">
                <UserIcon size={24} />
              </div>
            </div>
          </Card>
        </div>

        {/* Second Row: Layer Groups Card aligned under column 1 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Card 4: Layer Groups */}
          <Card variant="borderless" className="shadow-sm rounded-3xl hover:shadow-md transition-all group bg-white border border-gray-100/55 p-5">
            <div className="flex items-start justify-between">
              <div>
                <Text type="secondary" className="text-xs uppercase font-bold tracking-widest block mb-4 text-gray-400">Layer Groups</Text>
                <Title level={1} className="m-0 font-extrabold text-gray-800 leading-none">
                  {geoserverLoading ? <Spin size="small" /> : (geoserverData?.layerGroups?.length || 0)}
                </Title>
              </div>
              <div className="w-12 h-12 bg-teal-50 text-teal-600 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform shadow-sm">
                <Layers3 size={24} />
              </div>
            </div>
          </Card>
        </div>

      </div>
    </DashboardLayout>
  );
}
