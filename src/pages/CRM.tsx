import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Search, Building2, Filter, Save, X, MessageSquare,
  CircleDot, Mail, Phone, Calendar, Users,
} from "lucide-react";
import { toast } from "sonner";

const STATUSES = [
  { value: "new", label: "New", color: "bg-muted text-muted-foreground" },
  { value: "contacted", label: "Contacted", color: "bg-primary/20 text-primary" },
  { value: "replied", label: "Replied", color: "bg-accent/20 text-accent" },
  { value: "demo", label: "Demo", color: "bg-[hsl(45,90%,50%)]/20 text-[hsl(45,90%,50%)]" },
  { value: "closed", label: "Closed", color: "bg-destructive/20 text-destructive" },
] as const;

type StatusValue = typeof STATUSES[number]["value"];

interface Prospect {
  id: string;
  company_name: string;
  website: string | null;
  city: string | null;
  state: string | null;
  specialties: string | null;
  certifications: string | null;
  contact_name: string | null;
  contact_title: string | null;
  contact_email: string | null;
  employee_range: string | null;
  notes: string | null;
  lead_status: string;
}

export default function CRM() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [editingNotes, setEditingNotes] = useState<Prospect | null>(null);
  const [notesText, setNotesText] = useState("");
  const queryClient = useQueryClient();

  const { data: prospects = [], isLoading } = useQuery({
    queryKey: ["crm_prospects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prospect_companies")
        .select("id, company_name, website, city, state, specialties, certifications, contact_name, contact_title, contact_email, employee_range, notes, lead_status")
        .order("company_name");
      if (error) throw error;
      return data as Prospect[];
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Record<string, unknown> }) => {
      const { error } = await supabase
        .from("prospect_companies")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["crm_prospects"] }),
  });

  const changeStatus = (prospect: Prospect, newStatus: string) => {
    updateMutation.mutate(
      { id: prospect.id, updates: { lead_status: newStatus } },
      { onSuccess: () => toast.success(`${prospect.company_name} → ${newStatus}`) }
    );
  };

  const saveNotes = () => {
    if (!editingNotes) return;
    updateMutation.mutate(
      { id: editingNotes.id, updates: { notes: notesText } },
      {
        onSuccess: () => {
          toast.success(`Notes saved for ${editingNotes.company_name}`);
          setEditingNotes(null);
        },
      }
    );
  };

  const filtered = useMemo(() => {
    let result = prospects;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.company_name.toLowerCase().includes(q) ||
          c.contact_name?.toLowerCase().includes(q) ||
          c.specialties?.toLowerCase().includes(q)
      );
    }
    if (statusFilter !== "all") result = result.filter((c) => c.lead_status === statusFilter);
    return result;
  }, [prospects, search, statusFilter]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    STATUSES.forEach((s) => (counts[s.value] = 0));
    prospects.forEach((p) => {
      counts[p.lead_status] = (counts[p.lead_status] || 0) + 1;
    });
    return counts;
  }, [prospects]);

  const getStatusBadge = (status: string) => {
    const s = STATUSES.find((st) => st.value === status) || STATUSES[0];
    return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.color}`}>{s.label}</span>;
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-border bg-card/50 px-6 py-5">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Users className="h-6 w-6 text-primary" />
          Sales CRM
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {prospects.length} leads · {filtered.length} shown
        </p>

        {/* Status summary cards */}
        <div className="flex flex-wrap gap-3 mt-4">
          {STATUSES.map((s) => (
            <Card
              key={s.value}
              className={`cursor-pointer transition-all border-border hover:border-primary/50 ${statusFilter === s.value ? "ring-1 ring-primary" : ""}`}
              onClick={() => setStatusFilter(statusFilter === s.value ? "all" : s.value)}
            >
              <CardContent className="px-4 py-3 flex items-center gap-3">
                <CircleDot className={`h-4 w-4 ${s.color.split(" ")[1]}`} />
                <div>
                  <div className="text-lg font-bold">{statusCounts[s.value] || 0}</div>
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mt-4">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search company, contact, specialty..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-secondary/50 border-border"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px] bg-secondary/50 border-border">
              <Filter className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="px-6 py-4 overflow-x-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">Loading CRM…</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="w-[200px]">Company</TableHead>
                <TableHead className="w-[120px]">Location</TableHead>
                <TableHead className="w-[160px]">Contact</TableHead>
                <TableHead className="w-[120px]">Status</TableHead>
                <TableHead className="w-[200px]">Notes</TableHead>
                <TableHead className="w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow key={c.id} className="border-border hover:bg-secondary/30">
                  <TableCell>
                    <div className="font-medium text-sm">{c.company_name}</div>
                    <div className="text-[11px] text-muted-foreground line-clamp-1">{c.specialties || ""}</div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {c.city && c.state ? `${c.city}, ${c.state}` : c.state || "—"}
                  </TableCell>
                  <TableCell>
                    <div className="text-xs font-medium">{c.contact_name || "—"}</div>
                    <div className="text-[11px] text-muted-foreground">{c.contact_title}</div>
                    {c.contact_email && (
                      <div className="text-[11px] text-primary flex items-center gap-1 mt-0.5">
                        <Mail className="h-3 w-3" />{c.contact_email}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={c.lead_status}
                      onValueChange={(val) => changeStatus(c, val)}
                    >
                      <SelectTrigger className="h-7 w-[110px] border-none bg-transparent p-0">
                        {getStatusBadge(c.lead_status)}
                      </SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((s) => (
                          <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <div className="text-xs text-muted-foreground line-clamp-2">
                      {c.notes || <span className="italic">No notes</span>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => {
                        setEditingNotes(c);
                        setNotesText(c.notes || "");
                      }}
                    >
                      <MessageSquare className="h-3.5 w-3.5 mr-1" />
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                    No leads match your filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Notes Dialog */}
      <Dialog open={!!editingNotes} onOpenChange={() => setEditingNotes(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="h-4 w-4 text-primary" />
              Notes — {editingNotes?.company_name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Status:</span>
              {editingNotes && getStatusBadge(editingNotes.lead_status)}
            </div>
            <Textarea
              value={notesText}
              onChange={(e) => setNotesText(e.target.value)}
              placeholder="Add notes about this lead..."
              className="min-h-[160px] bg-secondary/30 border-border"
            />
            <div className="flex gap-2">
              <Button className="flex-1" onClick={saveNotes} disabled={updateMutation.isPending}>
                <Save className="h-4 w-4 mr-2" />
                Save Notes
              </Button>
              <Button variant="outline" onClick={() => setEditingNotes(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
