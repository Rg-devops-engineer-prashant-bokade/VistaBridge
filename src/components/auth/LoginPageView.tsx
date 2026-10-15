// ============================================================================
// LoginPageView Component (Authentication & Sign-in Interface)
//
// Dual-panel authentication screen:
// 1. Left hero banner: displays custom background imagery, branding, and quote
// 2. Right form card: collects username and password, authenticates against
//    GeoServer Spring Security, and stores JWT credentials in `useAuthStore`
// ============================================================================

/* eslint-disable @next/next/no-img-element */
'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { Form, Input, Button, Card, Typography, App, Spin, ConfigProvider } from 'antd';
import { User, Lock, ExternalLink } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { siteConfig } from '@/config/site-config';
import { useAuthStore } from '@/store/useAuthStore';
import { useAppearanceStore } from '@/store/useAppearanceStore';

const { Title, Text, Link } = Typography;

function LoginForm() {
  const { notification } = App.useApp();
  const [loading, setLoading] = useState(false);
  const { token, hydrated, setAuth } = useAuthStore();
  const {
    customLogo,
    productName,
    primaryColor,
    loginHeadline,
    loginSubtitle,
    loginBgUrl,
    loginQuote,
    fetchAppearance,
  } = useAppearanceStore();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [appearanceReady, setAppearanceReady] = useState(false);

  useEffect(() => {
    let active = true;

    // Fetch the latest appearance settings and preload the background image
    // before dismissing the loader, preventing any flicker or jump in text/wallpaper
    const prepareLoginAppearance = async () => {
      try {
        await fetchAppearance();
        const currentStore = useAppearanceStore.getState();
        const targetBg =
          currentStore.loginBgUrl ||
          'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2072&auto=format&fit=crop';

        // Preload background image into browser cache so it renders immediately
        if (typeof window !== 'undefined' && targetBg) {
          await new Promise<void>((resolve) => {
            const img = new Image();
            img.src = targetBg;
            img.onload = () => resolve();
            img.onerror = () => resolve();
            // Safeguard timeout (2.5s) to avoid hanging if the remote asset takes too long
            setTimeout(resolve, 2500);
          });
        }
      } catch (err) {
        console.error('Error settling login appearance:', err);
      } finally {
        if (active) {
          setAppearanceReady(true);
        }
      }
    };

    prepareLoginAppearance();

    return () => {
      active = false;
    };
  }, [fetchAppearance]);

  // Redirect authenticated users trying to access login page
  useEffect(() => {
    if (hydrated && token) {
      const redirect = searchParams.get('redirect') || '/overview';
      router.replace(redirect);
    }
  }, [hydrated, token, router, searchParams]);

  if (!hydrated || token || !appearanceReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8fafc]">
        <Spin size="large" />
      </div>
    );
  }

  interface LoginFormValues {
    username?: string;
    password?: string;
  }

  const onFinish = async (values: LoginFormValues) => {
    setLoading(true);
    try {
      const response = await fetch(`${siteConfig.api.baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });

      if (!response.ok) {
        throw new Error('Invalid credentials. Please try again.');
      }

      const data = await response.json();

      // Construct Basic Auth and GeoServer URL for direct client-side requests
      const basicAuth = 'Basic ' + btoa(`${values.username || ''}:${values.password || ''}`);
      const geoserverUrl = (data.geoserverUrl || 'http://localhost:8080/geoserver').replace(/\/$/, '');

      // Access token and GeoServer credentials are stored in memory/localStorage via Zustand.
      setAuth({
        username: values.username || '',
        role: data.role,
        geoserverAuth: basicAuth,
        geoserverUrl: geoserverUrl,
        email: data.email || `${values.username || 'user'}@vismap.com`,
        first_name: data.first_name || ((values.username?.charAt(0).toUpperCase() || 'U') + (values.username?.slice(1) || 'ser')),
        last_name: data.last_name || 'User'
      }, data.access);

      // Re-fetch appearance for this logged-in user so personal theme color loads
      fetchAppearance();

      notification.success({
        title: 'Authentication successful',
        description: `Welcome back to ${productName || siteConfig.name}.`,
        placement: 'topRight',
      });
      const redirect = searchParams.get('redirect') || '/overview';
      router.push(redirect);
    } catch (error: unknown) {
      notification.error({
        title: 'Login Failed',
        description: (error as Error).message || 'Invalid credentials. Please try again.',
        placement: 'topRight',
      });
    } finally {
      setLoading(false);
    }
  };

  const themeColor = primaryColor || siteConfig.colors.primary || '#0284c7';
  const displayName = productName?.trim() ? productName.trim() : siteConfig.name;
  const wallpaperUrl =
    loginBgUrl ||
    'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2072&auto=format&fit=crop';
  const headline = loginHeadline || 'Precision Geospatial \nIntelligence for All';
  const subtitle =
    loginSubtitle ||
    'Transforming raw data into actionable insights for government, NGOs, and enterprise organizations worldwide.';
  const quote = loginQuote ? `"${loginQuote}"` : '"Data is the new geography."';

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-white animate-in fade-in duration-300">
      {/* Left Panel: Satellite Image */}
      <div className="hidden lg:flex lg:w-3/5 relative overflow-hidden">
        <div
          className="absolute inset-0 z-0 bg-cover bg-center transition-transform duration-[10s] hover:scale-110"
          style={{
            backgroundImage: `url('${wallpaperUrl}')`,
          }}
        />
        <div
          className="absolute inset-0 z-10 transition-colors duration-500"
          style={{
            background: `linear-gradient(to bottom, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.25) 50%, color-mix(in srgb, ${themeColor} 30%, rgba(0,0,0,0.85)) 100%)`,
          }}
        />

        <div className="relative z-20 flex flex-col justify-between p-16 w-full text-white">
          <div className="flex items-center gap-3">
            {siteConfig.logo && (
              <img src={siteConfig.logo} alt="Logo" className="h-7 object-contain" />
            )}
            {customLogo && (
              <>
                <div className="h-5 w-[1px] bg-white/30" />
                <img src={customLogo} alt="Custom Logo" className="h-7 max-w-[120px] object-contain rounded" />
              </>
            )}
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold tracking-tight">{displayName}</span>
              {productName?.trim() && (
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded text-white backdrop-blur-xs transition-colors"
                  style={{ backgroundColor: `${themeColor}60`, border: `1px solid ${themeColor}90` }}
                >
                  {siteConfig.name}
                </span>
              )}
            </div>
          </div>

          <div className="max-w-xl">
            <h1 className="text-5xl font-bold leading-tight mb-6 whitespace-pre-line">
              {headline}
            </h1>
            <p className="text-lg text-white/80 leading-relaxed font-light">
              {subtitle}
            </p>
          </div>

          <div />
        </div>
      </div>

      {/* Right Panel: Login Form */}
      <div className="flex-1 flex flex-col justify-between p-8 sm:p-16 bg-[#f8fafc]">
        {/* Mobile Header */}
        <div className="lg:hidden flex items-center gap-2 mb-12">
          {siteConfig.logo && <img src={siteConfig.logo} alt="Logo" className="h-5" />}
          {customLogo && <img src={customLogo} alt="Custom Logo" className="h-5 max-w-[80px] object-contain" />}
          <span className="font-bold text-lg">{displayName}</span>
        </div>

        <div className="flex-grow flex flex-col justify-center max-w-md mx-auto w-full">
          <div className="mb-10 text-center lg:text-left">
            <Title level={2} className="m-0 mb-2">Welcome Back</Title>
            <Text type="secondary" className="text-base italic">{quote}</Text>
          </div>

          <Card variant="borderless" className="shadow-sm rounded-2xl p-4 sm:p-6 bg-white">
            <ConfigProvider
              theme={{
                token: {
                  colorPrimary: themeColor,
                },
                components: {
                  Button: {
                    colorPrimary: themeColor,
                  },
                  Input: {
                    activeBorderColor: themeColor,
                    hoverBorderColor: themeColor,
                  },
                },
              }}
            >
              <Form
                name="login"
                layout="vertical"
                onFinish={onFinish}
                requiredMark={false}
                size="large"
              >
                <Form.Item
                  name="username"
                  label={<span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Username</span>}
                  rules={[{ required: true, message: 'Please enter your username' }]}
                >
                  <Input
                    prefix={<User size={18} className="text-gray-400 mr-2" />}
                    placeholder="Enter your username"
                    className="vismap-input"
                  />
                </Form.Item>

                <Form.Item
                  name="password"
                  label={<span className="text-xs font-bold text-gray-500 uppercase tracking-widest">Password</span>}
                  rules={[{ required: true, message: 'Please enter your password' }]}
                >
                  <Input.Password
                    prefix={<Lock size={18} className="text-gray-400 mr-2" />}
                    placeholder="••••••••"
                    className="vismap-input"
                  />
                </Form.Item>

                <Form.Item className="mt-8 mb-0">
                  <Button
                    type="primary"
                    htmlType="submit"
                    className="w-full vismap-btn-primary login-submit-btn border-none transition-all h-12 rounded-xl text-base font-bold shadow-md hover:shadow-lg text-white cursor-pointer"
                    style={{
                      backgroundColor: themeColor,
                      borderColor: themeColor,
                      boxShadow: `0 4px 14px ${themeColor}40`,
                    }}
                    loading={loading}
                  >
                    Sign In
                  </Button>
                </Form.Item>
              </Form>
            </ConfigProvider>
          </Card>

          <div className="mt-8 text-center">
            <Text type="secondary" className="text-xs">
              Secure institutional access managed by {displayName} Identity.
            </Text>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center pt-8 border-t border-gray-100">
          <Text type="secondary" className="text-xs tracking-wide">
            Product by - {' '}
            <Link
              href="https://rottengrapes.tech/"
              target="_blank"
              className="font-semibold inline-flex items-center gap-1 transition-colors hover:opacity-80"
              style={{ color: themeColor }}
            >
              Rotten Grapes Private limited <ExternalLink size={12} />
            </Link>
          </Text>
        </div>
      </div>
    </div>
  );
}

export default function LoginPageView() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[#f8fafc]">
        <Spin size="large" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
