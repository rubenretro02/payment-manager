'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Plus,
  MoreHorizontal,
  Edit,
  Trash2,
  Loader2,
  Building,
  Calendar,
} from 'lucide-react';
import type { Platform } from '@/lib/types';

export default function PlatformsPage() {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<Platform | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    display_name: '',
    payment_schedule: '',
  });

  useEffect(() => {
    fetchPlatforms();
  }, []);

  async function fetchPlatforms() {
    try {
      const response = await fetch('/api/platforms');
      const data = await response.json();
      if (data.success) {
        setPlatforms(data.data || []);
      }
    } catch (error) {
      console.error('Error fetching platforms:', error);
    } finally {
      setLoading(false);
    }
  }

  const handleAdd = async () => {
    try {
      const response = await fetch('/api/platforms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await response.json();
      if (data.success) {
        await fetchPlatforms();
        setIsAddDialogOpen(false);
        setFormData({ name: '', display_name: '', payment_schedule: '' });
      }
    } catch (error) {
      console.error('Error adding platform:', error);
    }
  };

  const handleEdit = async () => {
    if (!selectedPlatform) return;
    try {
      const response = await fetch(`/api/platforms/${selectedPlatform.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await response.json();
      if (data.success) {
        await fetchPlatforms();
        setIsEditDialogOpen(false);
        setSelectedPlatform(null);
        setFormData({ name: '', display_name: '', payment_schedule: '' });
      }
    } catch (error) {
      console.error('Error editing platform:', error);
    }
  };

  const handleDelete = async () => {
    if (!selectedPlatform) return;
    try {
      const response = await fetch(`/api/platforms/${selectedPlatform.id}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (data.success) {
        await fetchPlatforms();
        setIsDeleteDialogOpen(false);
        setSelectedPlatform(null);
      }
    } catch (error) {
      console.error('Error deleting platform:', error);
    }
  };

  const openEditDialog = (platform: Platform) => {
    setSelectedPlatform(platform);
    setFormData({
      name: platform.name,
      display_name: platform.display_name,
      payment_schedule: platform.payment_schedule || '',
    });
    setIsEditDialogOpen(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Platforms</h1>
          <p className="text-muted-foreground">
            Manage work platforms (Omni, Arise, LiveOps, etc.)
          </p>
        </div>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Add Platform
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add New Platform</DialogTitle>
              <DialogDescription>
                Add a new work platform to the system.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="display_name">Platform Name *</Label>
                <Input
                  id="display_name"
                  placeholder="e.g., LiveOps"
                  value={formData.display_name}
                  onChange={(e) => setFormData({
                    ...formData,
                    display_name: e.target.value,
                    name: e.target.value.toLowerCase().replace(/\s+/g, '_')
                  })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="name">System Name</Label>
                <Input
                  id="name"
                  placeholder="e.g., liveops"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                />
                <p className="text-xs text-muted-foreground">
                  Lowercase, no spaces. Auto-generated from platform name.
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="payment_schedule">Payment Schedule (optional)</Label>
                <Input
                  id="payment_schedule"
                  placeholder="e.g., Weekly - Fridays"
                  value={formData.payment_schedule}
                  onChange={(e) => setFormData({ ...formData, payment_schedule: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleAdd}
                disabled={!formData.display_name || !formData.name}
              >
                Add Platform
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Platforms</p>
                <p className="text-2xl font-bold">{platforms.length}</p>
              </div>
              <Building className="h-8 w-8 text-muted-foreground/20" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {platforms.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Building className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="font-medium">No platforms registered</p>
              <p className="text-sm">Add a new platform to get started</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Platform</TableHead>
                  <TableHead>System Name</TableHead>
                  <TableHead>Payment Schedule</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {platforms.map((platform) => (
                  <TableRow key={platform.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                          <Building className="h-4 w-4 text-primary" />
                        </div>
                        <span className="font-medium">{platform.display_name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{platform.name}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {platform.payment_schedule || '—'}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => openEditDialog(platform)}>
                            <Edit className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => {
                              setSelectedPlatform(platform);
                              setIsDeleteDialogOpen(true);
                            }}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Platform</DialogTitle>
            <DialogDescription>
              Update platform information.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit_display_name">Platform Name *</Label>
              <Input
                id="edit_display_name"
                value={formData.display_name}
                onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit_name">System Name</Label>
              <Input
                id="edit_name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit_payment_schedule">Payment Schedule</Label>
              <Input
                id="edit_payment_schedule"
                value={formData.payment_schedule}
                onChange={(e) => setFormData({ ...formData, payment_schedule: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEdit}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Platform</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{selectedPlatform?.display_name}"?
              This will also delete all accounts associated with this platform.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete Platform
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
