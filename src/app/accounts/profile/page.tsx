// ============================================================================
// User Profile & Account Security Page (/accounts/profile)
//
// Manages the authenticated user's account:
// - Displays username, email, user role (ADMIN/USER), and connected GeoServer URL
// - Password update form to change credentials on the GeoServer backend
// ============================================================================

'use client';

import React, { useEffect, useState } from 'react';
import { Typography, Card, Input, Button, Avatar, Tag, App, Divider, Spin, Popover } from 'antd';
import { useRouter } from 'next/navigation';
import { User, Lock, ShieldCheck, KeyRound } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuthStore } from '@/store/useAuthStore';
import { apiRequest } from '@/lib/api';

const { Title, Text } = Typography;

export default function ProfilePage() {
  const router = useRouter();
  const { notification } = App.useApp();
  const { token, user, setAuth, hydrated } = useAuthStore();
  const [saving, setSaving] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Profile Form states
  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState('MEMBER');

  // Password Form states
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    if (!token) {
      router.replace('/login');
      return;
    }
    let isSubscribed = true;
    const fetchProfile = async () => {
      try {
        const response = await apiRequest('/auth/profile/');
        if (!response.ok) throw new Error('Failed to fetch profile info.');
        const data = await response.json();
        if (!isSubscribed) return;
        setUsername(data.username || '');
        setFirstName(data.first_name || '');
        setLastName(data.last_name || '');
        setRole(data.profile?.role || 'MEMBER');
      } catch (err: unknown) {
        if (!isSubscribed) return;
        const msg = err instanceof Error ? err.message : 'Could not fetch your profile data.';
        notification.error({
          message: 'Error Loading Profile',
          description: msg,
          placement: 'topRight'
        });
      }
    };
    void fetchProfile();
    return () => {
      isSubscribed = false;
    };
  }, [hydrated, token, router, notification]);

  const handleSaveProfile = async () => {
    if (!firstName || firstName.trim().length === 0) {
      notification.error({
        message: 'First Name Required',
        description: 'Please enter your first name to update your profile.',
        placement: 'topRight'
      });
      return;
    }
    if (firstName.length > 16) {
      notification.error({
        message: 'First Name Too Long',
        description: 'First name must not exceed 16 characters.',
        placement: 'topRight'
      });
      return;
    }
    if (!/^[a-zA-Z]+$/.test(firstName)) {
      notification.error({
        message: 'Invalid First Name',
        description: 'First name must contain only letters (A-Z/a-z).',
        placement: 'topRight'
      });
      return;
    }

    if (!lastName || lastName.trim().length === 0) {
      notification.error({
        message: 'Last Name Required',
        description: 'Please enter your last name to update your profile.',
        placement: 'topRight'
      });
      return;
    }
    if (lastName.length > 16) {
      notification.error({
        message: 'Last Name Too Long',
        description: 'Last name must not exceed 16 characters.',
        placement: 'topRight'
      });
      return;
    }
    if (!/^[a-zA-Z]+$/.test(lastName)) {
      notification.error({
        message: 'Invalid Last Name',
        description: 'Last name must contain only letters (A-Z/a-z).',
        placement: 'topRight'
      });
      return;
    }

    setSaving(true);
    try {
      const response = await apiRequest('/auth/profile/', {
        method: 'PUT',
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName
        })
      });

      if (!response.ok) {
        const errors = await response.json();
        throw new Error(errors.first_name?.[0] || errors.last_name?.[0] || 'Failed to update profile.');
      }

      const updatedUser = await response.json();

      if (user) {
        setAuth({
          ...user,
          first_name: updatedUser.first_name,
          last_name: updatedUser.last_name
        }, token || '');
      }

      notification.success({
        message: 'Profile Updated',
        description: 'Your profile details have been successfully saved.',
        placement: 'topRight'
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not save profile changes.';
      notification.error({
        message: 'Update Failed',
        description: msg,
        placement: 'topRight'
      });
    } finally {
      setSaving(false);
    }
  };

  const isPasswordStrengthMet =
    newPassword.length >= 8 &&
    !/\s/.test(newPassword) &&
    /[A-Z]/.test(newPassword) &&
    /[a-z]/.test(newPassword) &&
    /[0-9]/.test(newPassword);

  const isPasswordSubmitDisabled =
    !oldPassword ||
    !newPassword ||
    !confirmPassword ||
    newPassword !== confirmPassword ||
    !isPasswordStrengthMet;

  const handleChangePassword = async () => {
    if (!oldPassword || !newPassword || !confirmPassword) return;
    if (newPassword !== confirmPassword) return;
    if (!isPasswordStrengthMet) return;

    if (newPassword === oldPassword) {
      notification.error({
        message: 'Duplicate Password',
        description: 'New password cannot be the same as your current password.',
        placement: 'topRight'
      });
      return;
    }

    setPasswordLoading(true);
    try {
      const response = await apiRequest('/auth/update-password/', {
        method: 'POST',
        body: JSON.stringify({
          old_password: oldPassword,
          new_password: newPassword,
          confirm_new_password: confirmPassword
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.old_password?.[0] || data.new_password?.[0] || data.detail || 'Failed to update password.');
      }

      // Update the auth store locally so subsequent requests carry the new password Basic auth
      if (data.geoserverAuth) {
        if (user && token) {
          setAuth({ ...user, geoserverAuth: data.geoserverAuth }, token);
        }
      }

      notification.success({
        message: 'Password Updated',
        description: 'Your password was successfully updated.',
        placement: 'topRight'
      });

      // Clear fields
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error occurred while updating your password.';
      notification.error({
        message: 'Password Change Failed',
        description: msg,
        placement: 'topRight'
      });
    } finally {
      setPasswordLoading(false);
    }
  };

  if (!hydrated) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <Spin size="large" />
      </div>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-[1.25rem] sm:space-y-[1.5rem] animate-in fade-in slide-in-from-bottom-[1rem] duration-700 pb-[5rem]">
        <div className="flex flex-col gap-[0.25rem]">
          <Title level={2} className="!m-0 !text-[1.125rem] sm:!text-[1.375rem] md:!text-[1.625rem] font-black text-gray-900 tracking-tight">User Account Profile</Title>
          <Text className="text-[0.75rem] sm:text-[0.875rem] text-gray-400 font-medium">Manage your personal information and security credentials.</Text>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-[1.25rem] sm:gap-[1.5rem]">
          {/* Card Left: Avatar & Roles */}
          <Card
            variant="borderless"
            className="shadow-md border border-gray-100/50 rounded-[2rem] text-center bg-white lg:col-span-1 relative overflow-hidden"
            styles={{ body: { padding: isMobile ? '1.25rem' : '1.5rem' } }}
          >
            <div className="flex flex-col items-center gap-[1.25rem] py-[1rem]">
              <div className="relative">
                <Avatar
                  className="bg-primary/10 text-primary border border-primary/20 flex items-center justify-center font-bold shrink-0 shadow-sm ring-4 ring-primary/10 ring-offset-2"
                  style={{
                    width: isMobile ? '5.5rem' : '6.5rem',
                    height: isMobile ? '5.5rem' : '6.5rem',
                    fontSize: isMobile ? '2.25rem' : '2.75rem',
                  }}
                >
                  {firstName ? firstName.charAt(0).toUpperCase() : lastName ? lastName.charAt(0).toUpperCase() : username ? username.charAt(0).toUpperCase() : <User size={48} />}
                </Avatar>
              </div>
              <div className="min-w-0 flex-1">
                <Title level={4} className="!m-0 text-[1.125rem] sm:text-[1.25rem] font-extrabold text-gray-800 truncate" title={firstName || lastName ? `${firstName} ${lastName || ''}`.trim() : username || 'Institutional User'}>
                  {firstName || lastName ? `${firstName} ${lastName || ''}`.trim() : username || 'Institutional User'}
                </Title>
                <Text type="secondary" className="text-[0.75rem] font-semibold font-mono block mt-[0.375rem] text-primary bg-primary/5 px-[0.75rem] py-[0.125rem] rounded-full w-fit mx-auto">{username}</Text>
              </div>
              <div className="flex flex-wrap gap-[0.5rem] justify-center">
                <Tag color={role === 'ADMIN' ? 'red' : 'blue'} className="text-[0.625rem] font-black uppercase tracking-widest rounded-full border-none px-[1rem] py-[0.25rem] shadow-sm">
                  {role} Role
                </Tag>
              </div>
            </div>
            <Divider className="my-[1rem] border-gray-100" />
            <div className="text-left space-y-[0.75rem] px-[0.5rem]">
              <div className="flex justify-between items-center text-[0.75rem]">
                <Text className="font-bold text-gray-400 uppercase tracking-wider text-[0.6875rem]">Account Status</Text>
                <Tag color="green" className="text-[0.5625rem] font-bold uppercase tracking-wider rounded-full border-none px-[0.625rem] py-[0.125rem]">Active</Tag>
              </div>
            </div>
          </Card>

          {/* Card Right: Forms */}
          <div className="lg:col-span-2 space-y-[1.25rem] sm:space-y-[1.5rem]">
            {/* Profile Details Card */}
            <Card
              variant="borderless"
              title={
                <div className="flex items-center gap-[0.5rem] text-[0.875rem] font-bold text-gray-800">
                  <div className="p-[0.375rem] bg-primary/10 text-primary rounded-[0.5rem] flex shrink-0">
                    <User size={16} />
                  </div>
                  <span>Profile Details</span>
                </div>
              }
              className="shadow-md border border-gray-100/50 rounded-[2rem] bg-white overflow-hidden"
              styles={{ body: { padding: isMobile ? '1.25rem' : '2rem' } }}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-[1.25rem] sm:gap-[1rem]">
                <div>
                  <label className="block text-[0.6875rem] font-bold text-gray-400 uppercase tracking-widest mb-[0.5rem] ml-[0.25rem]">First Name</label>
                  <Input
                    prefix={<User size={16} className="text-gray-400 mr-[0.5rem]" />}
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value.replace(/[^a-zA-Z]/g, ''))}
                    className="vismap-input rounded-[1rem] border-gray-200 h-[2.75rem] text-[0.875rem] bg-gray-50/50 hover:bg-gray-100/50 focus:bg-white focus:border-primary/40 focus:ring-4 focus:ring-primary/5 transition-all font-semibold"
                    placeholder="John"
                    maxLength={16}
                  />
                </div>
                <div>
                  <label className="block text-[0.6875rem] font-bold text-gray-400 uppercase tracking-widest mb-[0.5rem] ml-[0.25rem]">Last Name</label>
                  <Input
                    prefix={<User size={16} className="text-gray-400 mr-[0.5rem]" />}
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value.replace(/[^a-zA-Z]/g, ''))}
                    className="vismap-input rounded-[1rem] border-gray-200 h-[2.75rem] text-[0.875rem] bg-gray-50/50 hover:bg-gray-100/50 focus:bg-white focus:border-primary/40 focus:ring-4 focus:ring-primary/5 transition-all font-semibold"
                    placeholder="Doe"
                    maxLength={16}
                  />
                </div>
              </div>
              <div className="mt-[1.5rem] flex sm:justify-end">
                <Button
                  type="primary"
                  loading={saving}
                  onClick={handleSaveProfile}
                  className="rounded-[1rem] h-[2.75rem] px-[2rem] font-bold shadow-md hover:shadow-lg text-[0.875rem] w-full sm:w-auto hover:scale-[1.02] active:scale-[0.98] transition-transform border-none flex items-center justify-center"
                >
                  Save Profile Changes
                </Button>
              </div>
            </Card>

            {/* Password Fields Card */}
            <Card
              variant="borderless"
              title={
                <div className="flex items-center gap-[0.5rem] text-[0.875rem] font-bold text-gray-800">
                  <div className="p-[0.375rem] bg-primary/10 text-primary rounded-[0.5rem] flex shrink-0">
                    <KeyRound size={16} />
                  </div>
                  <span>Update Account Password</span>
                </div>
              }
              className="shadow-md border border-gray-100/50 rounded-[2rem] bg-white overflow-hidden"
              styles={{ body: { padding: isMobile ? '1.25rem' : '2rem' } }}
            >
              <div className="space-y-[1.25rem]">
                <div>
                  <label className="block text-[0.6875rem] font-bold text-gray-400 uppercase tracking-widest mb-[0.5rem] ml-[0.25rem]">Current Password</label>
                  <Input.Password
                    prefix={<Lock size={16} className="text-gray-400 mr-[0.5rem]" />}
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    autoComplete="new-password"
                    className="vismap-input rounded-[1rem] border-gray-200 h-[2.75rem] text-[0.875rem] bg-gray-50/50 hover:bg-gray-100/50 focus:bg-white focus:border-primary/40 focus:ring-4 focus:ring-primary/5 transition-all font-semibold"
                    placeholder="Enter current password"
                  />
                </div>

                <div>
                  <label className="block text-[0.6875rem] font-bold text-gray-400 uppercase tracking-widest mb-[0.5rem] ml-[0.25rem]">New Password</label>
                  <Popover
                    content={
                      <div className="space-y-[0.375rem] p-[0.25rem]">
                        <span className="text-[0.625rem] text-gray-500 font-bold block mb-[0.25rem] uppercase tracking-wider">Password Requirements</span>
                        {[
                          { label: 'Minimum 8 characters', met: newPassword.length >= 8 },
                          { label: 'No spaces allowed', met: newPassword.length > 0 && !/\s/.test(newPassword) },
                          { label: 'At least one uppercase letter (A-Z)', met: /[A-Z]/.test(newPassword) },
                          { label: 'At least one lowercase letter (a-z)', met: /[a-z]/.test(newPassword) },
                          { label: 'At least one number (0-9)', met: /[0-9]/.test(newPassword) }
                        ].map((rule, idx) => (
                          <div key={idx} className="flex items-center gap-[0.375rem] text-[0.625rem] font-medium transition-colors">
                            <span className={`w-[0.375rem] h-[0.375rem] rounded-full shrink-0 ${newPassword.length === 0 ? 'bg-gray-300' : (rule.met ? 'bg-green-500' : 'bg-red-500')
                              }`} />
                            <span className={
                              newPassword.length === 0 ? 'text-gray-400' : (rule.met ? 'text-green-600' : 'text-red-500')
                            }>{rule.label}</span>
                          </div>
                        ))}
                      </div>
                    }
                    trigger="focus"
                    placement="bottomLeft"
                  >
                    <Input.Password
                      prefix={<Lock size={16} className="text-gray-400 mr-[0.5rem]" />}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      autoComplete="new-password"
                      className="vismap-input rounded-[1rem] border-gray-200 h-[2.75rem] text-[0.875rem] bg-gray-50/50 hover:bg-gray-100/50 focus:bg-white focus:border-primary/40 focus:ring-4 focus:ring-primary/5 transition-all font-semibold"
                      placeholder="Enter new password"
                    />
                  </Popover>
                </div>

                <div>
                  <label className="block text-[0.6875rem] font-bold text-gray-400 uppercase tracking-widest mb-[0.5rem] ml-[0.25rem]">Confirm New Password</label>
                  <Input.Password
                    prefix={<Lock size={16} className="text-gray-400 mr-[0.5rem]" />}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    className="vismap-input rounded-[1rem] border-gray-200 h-[2.75rem] text-[0.875rem] bg-gray-50/50 hover:bg-gray-100/50 focus:bg-white focus:border-primary/40 focus:ring-4 focus:ring-primary/5 transition-all font-semibold"
                    placeholder="Re-enter new password"
                  />
                  {confirmPassword && newPassword !== confirmPassword && (
                    <span className="text-[0.625rem] text-red-500 font-semibold block mt-[0.375rem] ml-[0.25rem]">
                      New passwords do not match.
                    </span>
                  )}
                </div>

                <div className="pt-[1rem] flex sm:justify-end">
                  <Button
                    type="primary"
                    loading={passwordLoading}
                    onClick={handleChangePassword}
                    icon={<ShieldCheck size={16} />}
                    disabled={isPasswordSubmitDisabled}
                    className="rounded-[1rem] h-[2.75rem] px-[2rem] font-bold shadow-md hover:shadow-lg flex items-center justify-center gap-[0.5rem] text-[0.875rem] w-full sm:w-auto hover:scale-[1.02] active:scale-[0.98] transition-transform border-none"
                  >
                    Change Password
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
