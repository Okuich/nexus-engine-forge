export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      agent_executions: {
        Row: {
          completed_at: string | null
          created_at: string
          goal: string
          id: string
          model_used: string | null
          plan: Json
          results: Json
          status: string
          tenant_id: string | null
          token_usage: Json | null
          total_duration_ms: number | null
          user_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          goal: string
          id?: string
          model_used?: string | null
          plan?: Json
          results?: Json
          status?: string
          tenant_id?: string | null
          token_usage?: Json | null
          total_duration_ms?: number | null
          user_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          goal?: string
          id?: string
          model_used?: string | null
          plan?: Json
          results?: Json
          status?: string
          tenant_id?: string | null
          token_usage?: Json | null
          total_duration_ms?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_executions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_memory: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          key: string
          memory_type: string
          tenant_id: string | null
          ttl_seconds: number | null
          value: Json
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          key: string
          memory_type: string
          tenant_id?: string | null
          ttl_seconds?: number | null
          value: Json
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          key?: string
          memory_type?: string
          tenant_id?: string | null
          ttl_seconds?: number | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "agent_memory_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          ip_address: string | null
          metadata: Json | null
          resource_id: string | null
          resource_type: string
          tenant_id: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          resource_id?: string | null
          resource_type: string
          tenant_id?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          resource_id?: string | null
          resource_type?: string
          tenant_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_feedback: {
        Row: {
          actual_cost: number
          complexity_score: number
          correction_factor: number | null
          created_at: string
          estimate_id: string
          id: string
          material: string
          notes: string | null
          predicted_cost: number
          process: string
          tenant_id: string | null
          user_id: string | null
        }
        Insert: {
          actual_cost: number
          complexity_score?: number
          correction_factor?: number | null
          created_at?: string
          estimate_id: string
          id?: string
          material: string
          notes?: string | null
          predicted_cost: number
          process: string
          tenant_id?: string | null
          user_id?: string | null
        }
        Update: {
          actual_cost?: number
          complexity_score?: number
          correction_factor?: number | null
          created_at?: string
          estimate_id?: string
          id?: string
          material?: string
          notes?: string | null
          predicted_cost?: number
          process?: string
          tenant_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cost_feedback_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_orders: {
        Row: {
          buyer_id: string
          created_at: string
          currency: string
          id: string
          metadata: Json | null
          platform_fee_pct: number
          platform_fee_usd: number
          quantity: number
          quote_id: string | null
          rfq_id: string | null
          status: string
          subtotal_usd: number
          supplier_id: string
          supplier_payout_usd: number
          tax_usd: number
          total_usd: number
          unit_price_usd: number
          updated_at: string
        }
        Insert: {
          buyer_id: string
          created_at?: string
          currency?: string
          id?: string
          metadata?: Json | null
          platform_fee_pct?: number
          platform_fee_usd?: number
          quantity?: number
          quote_id?: string | null
          rfq_id?: string | null
          status?: string
          subtotal_usd: number
          supplier_id: string
          supplier_payout_usd?: number
          tax_usd?: number
          total_usd: number
          unit_price_usd: number
          updated_at?: string
        }
        Update: {
          buyer_id?: string
          created_at?: string
          currency?: string
          id?: string
          metadata?: Json | null
          platform_fee_pct?: number
          platform_fee_usd?: number
          quantity?: number
          quote_id?: string | null
          rfq_id?: string | null
          status?: string
          subtotal_usd?: number
          supplier_id?: string
          supplier_payout_usd?: number
          tax_usd?: number
          total_usd?: number
          unit_price_usd?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_orders_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "rfq_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_orders_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "rfqs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "supplier_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_payments: {
        Row: {
          amount_usd: number
          created_at: string
          external_payment_id: string | null
          failure_reason: string | null
          id: string
          metadata: Json | null
          order_id: string
          paid_at: string | null
          payer_id: string
          payment_method: string
          platform_fee_usd: number
          status: string
          supplier_payout_usd: number
          updated_at: string
        }
        Insert: {
          amount_usd: number
          created_at?: string
          external_payment_id?: string | null
          failure_reason?: string | null
          id?: string
          metadata?: Json | null
          order_id: string
          paid_at?: string | null
          payer_id: string
          payment_method?: string
          platform_fee_usd?: number
          status?: string
          supplier_payout_usd?: number
          updated_at?: string
        }
        Update: {
          amount_usd?: number
          created_at?: string
          external_payment_id?: string | null
          failure_reason?: string | null
          id?: string
          metadata?: Json | null
          order_id?: string
          paid_at?: string | null
          payer_id?: string
          payment_method?: string
          platform_fee_usd?: number
          status?: string
          supplier_payout_usd?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "marketplace_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      model_benchmarks: {
        Row: {
          accuracy: number | null
          created_at: string
          dataset_name: string
          f1_score: number | null
          gpu_memory_mb: number | null
          id: string
          job_id: string | null
          latency_mean_ms: number
          latency_p50_ms: number | null
          latency_p95_ms: number | null
          latency_p99_ms: number | null
          mae: number
          mape: number | null
          metadata: Json | null
          model_type: string
          model_version_id: string | null
          mse: number | null
          rmse: number | null
          sample_count: number
          tenant_id: string | null
          throughput_rps: number | null
          train_loss: number | null
          val_loss: number | null
        }
        Insert: {
          accuracy?: number | null
          created_at?: string
          dataset_name: string
          f1_score?: number | null
          gpu_memory_mb?: number | null
          id?: string
          job_id?: string | null
          latency_mean_ms: number
          latency_p50_ms?: number | null
          latency_p95_ms?: number | null
          latency_p99_ms?: number | null
          mae: number
          mape?: number | null
          metadata?: Json | null
          model_type?: string
          model_version_id?: string | null
          mse?: number | null
          rmse?: number | null
          sample_count?: number
          tenant_id?: string | null
          throughput_rps?: number | null
          train_loss?: number | null
          val_loss?: number | null
        }
        Update: {
          accuracy?: number | null
          created_at?: string
          dataset_name?: string
          f1_score?: number | null
          gpu_memory_mb?: number | null
          id?: string
          job_id?: string | null
          latency_mean_ms?: number
          latency_p50_ms?: number | null
          latency_p95_ms?: number | null
          latency_p99_ms?: number | null
          mae?: number
          mape?: number | null
          metadata?: Json | null
          model_type?: string
          model_version_id?: string | null
          mse?: number | null
          rmse?: number | null
          sample_count?: number
          tenant_id?: string | null
          throughput_rps?: number | null
          train_loss?: number | null
          val_loss?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "model_benchmarks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "training_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "model_benchmarks_model_version_id_fkey"
            columns: ["model_version_id"]
            isOneToOne: false
            referencedRelation: "model_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "model_benchmarks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      model_versions: {
        Row: {
          artifact_path: string | null
          created_at: string
          id: string
          is_active: boolean
          job_id: string
          metrics: Json | null
          model_type: string
          tenant_id: string | null
          version: string
        }
        Insert: {
          artifact_path?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          job_id: string
          metrics?: Json | null
          model_type: string
          tenant_id?: string | null
          version: string
        }
        Update: {
          artifact_path?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          job_id?: string
          metrics?: Json | null
          model_type?: string
          tenant_id?: string | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "model_versions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "training_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "model_versions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      price_quotes: {
        Row: {
          account_id: string | null
          applied_rules: Json
          base_cost_usd: number
          created_at: string
          created_by: string
          final_price_usd: number
          id: string
          line_items: Json
          margin_pct: number
          material: string
          metadata: Json | null
          process: string
          quantity: number
        }
        Insert: {
          account_id?: string | null
          applied_rules?: Json
          base_cost_usd: number
          created_at?: string
          created_by: string
          final_price_usd: number
          id?: string
          line_items?: Json
          margin_pct: number
          material: string
          metadata?: Json | null
          process: string
          quantity?: number
        }
        Update: {
          account_id?: string | null
          applied_rules?: Json
          base_cost_usd?: number
          created_at?: string
          created_by?: string
          final_price_usd?: number
          id?: string
          line_items?: Json
          margin_pct?: number
          material?: string
          metadata?: Json | null
          process?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "price_quotes_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "pricing_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_accounts: {
        Row: {
          account_name: string
          account_type: string
          active: boolean
          base_margin_pct: number
          created_at: string
          created_by: string
          id: string
          metadata: Json | null
          preferred_supplier_ids: string[]
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          account_name: string
          account_type?: string
          active?: boolean
          base_margin_pct?: number
          created_at?: string
          created_by: string
          id?: string
          metadata?: Json | null
          preferred_supplier_ids?: string[]
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          account_name?: string
          account_type?: string
          active?: boolean
          base_margin_pct?: number
          created_at?: string
          created_by?: string
          id?: string
          metadata?: Json | null
          preferred_supplier_ids?: string[]
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_rules: {
        Row: {
          account_id: string
          active: boolean
          adjustments: Json
          conditions: Json
          created_at: string
          description: string | null
          id: string
          priority: number
          rule_type: string
          updated_at: string
        }
        Insert: {
          account_id: string
          active?: boolean
          adjustments?: Json
          conditions?: Json
          created_at?: string
          description?: string | null
          id?: string
          priority?: number
          rule_type: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          active?: boolean
          adjustments?: Json
          conditions?: Json
          created_at?: string
          description?: string | null
          id?: string
          priority?: number
          rule_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_rules_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "pricing_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      prospect_companies: {
        Row: {
          certifications: string | null
          city: string | null
          company_name: string
          contact_email: string | null
          contact_linkedin: string | null
          contact_name: string | null
          contact_title: string | null
          created_at: string
          employee_range: string | null
          id: string
          lead_status: string
          notes: string | null
          outreach_email: string | null
          specialties: string | null
          state: string | null
          website: string | null
        }
        Insert: {
          certifications?: string | null
          city?: string | null
          company_name: string
          contact_email?: string | null
          contact_linkedin?: string | null
          contact_name?: string | null
          contact_title?: string | null
          created_at?: string
          employee_range?: string | null
          id?: string
          lead_status?: string
          notes?: string | null
          outreach_email?: string | null
          specialties?: string | null
          state?: string | null
          website?: string | null
        }
        Update: {
          certifications?: string | null
          city?: string | null
          company_name?: string
          contact_email?: string | null
          contact_linkedin?: string | null
          contact_name?: string | null
          contact_title?: string | null
          created_at?: string
          employee_range?: string | null
          id?: string
          lead_status?: string
          notes?: string | null
          outreach_email?: string | null
          specialties?: string | null
          state?: string | null
          website?: string | null
        }
        Relationships: []
      }
      rfq_quotes: {
        Row: {
          adjustments: Json | null
          confidence: number
          created_at: string
          id: string
          lead_time_days: number
          notes: string | null
          rank: number | null
          rfq_id: string
          score: number | null
          score_breakdown: Json | null
          status: string
          supplier_id: string
          total_price_usd: number
          unit_price_usd: number
          updated_at: string
        }
        Insert: {
          adjustments?: Json | null
          confidence?: number
          created_at?: string
          id?: string
          lead_time_days: number
          notes?: string | null
          rank?: number | null
          rfq_id: string
          score?: number | null
          score_breakdown?: Json | null
          status?: string
          supplier_id: string
          total_price_usd: number
          unit_price_usd: number
          updated_at?: string
        }
        Update: {
          adjustments?: Json | null
          confidence?: number
          created_at?: string
          id?: string
          lead_time_days?: number
          notes?: string | null
          rank?: number | null
          rfq_id?: string
          score?: number | null
          score_breakdown?: Json | null
          status?: string
          supplier_id?: string
          total_price_usd?: number
          unit_price_usd?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rfq_quotes_rfq_id_fkey"
            columns: ["rfq_id"]
            isOneToOne: false
            referencedRelation: "rfqs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfq_quotes_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "supplier_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rfqs: {
        Row: {
          complexity_score: number
          created_at: string
          created_by: string
          deadline: string | null
          description: string | null
          geometry_stats: Json | null
          id: string
          material: string
          max_lead_time_days: number | null
          part_name: string
          process: string
          quantity: number
          region: string | null
          required_certifications: string[]
          status: string
          surface_classes: string[]
          target_cost_usd: number | null
          tenant_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          complexity_score?: number
          created_at?: string
          created_by: string
          deadline?: string | null
          description?: string | null
          geometry_stats?: Json | null
          id?: string
          material: string
          max_lead_time_days?: number | null
          part_name: string
          process: string
          quantity?: number
          region?: string | null
          required_certifications?: string[]
          status?: string
          surface_classes?: string[]
          target_cost_usd?: number | null
          tenant_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          complexity_score?: number
          created_at?: string
          created_by?: string
          deadline?: string | null
          description?: string | null
          geometry_stats?: Json | null
          id?: string
          material?: string
          max_lead_time_days?: number | null
          part_name?: string
          process?: string
          quantity?: number
          region?: string | null
          required_certifications?: string[]
          status?: string
          surface_classes?: string[]
          target_cost_usd?: number | null
          tenant_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rfqs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_payouts: {
        Row: {
          amount_usd: number
          created_at: string
          external_payout_id: string | null
          id: string
          metadata: Json | null
          order_id: string
          payment_id: string
          payout_method: string
          processed_at: string | null
          status: string
          supplier_id: string
        }
        Insert: {
          amount_usd: number
          created_at?: string
          external_payout_id?: string | null
          id?: string
          metadata?: Json | null
          order_id: string
          payment_id: string
          payout_method?: string
          processed_at?: string | null
          status?: string
          supplier_id: string
        }
        Update: {
          amount_usd?: number
          created_at?: string
          external_payout_id?: string | null
          id?: string
          metadata?: Json | null
          order_id?: string
          payment_id?: string
          payout_method?: string
          processed_at?: string | null
          status?: string
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_payouts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "marketplace_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payouts_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "marketplace_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payouts_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "supplier_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_profiles: {
        Row: {
          active: boolean
          advanced_surfaces: string[]
          certifications: string[]
          company_name: string
          created_at: string
          id: string
          lead_time_days: number
          materials: string[]
          max_complexity: number
          min_order_usd: number
          pricing_multiplier: number
          processes: string[]
          quality_rating: number
          region: string
          tenant_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          advanced_surfaces?: string[]
          certifications?: string[]
          company_name: string
          created_at?: string
          id?: string
          lead_time_days?: number
          materials?: string[]
          max_complexity?: number
          min_order_usd?: number
          pricing_multiplier?: number
          processes?: string[]
          quality_rating?: number
          region?: string
          tenant_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          advanced_surfaces?: string[]
          certifications?: string[]
          company_name?: string
          created_at?: string
          id?: string
          lead_time_days?: number
          materials?: string[]
          max_complexity?: number
          min_order_usd?: number
          pricing_multiplier?: number
          processes?: string[]
          quality_rating?: number
          region?: string
          tenant_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_members: {
        Row: {
          id: string
          invited_at: string
          joined_at: string | null
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          user_id: string
        }
        Insert: {
          id?: string
          invited_at?: string
          joined_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          user_id: string
        }
        Update: {
          id?: string
          invited_at?: string
          joined_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          name: string
          settings: Json | null
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          settings?: Json | null
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          settings?: Json | null
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      training_jobs: {
        Row: {
          completed_at: string | null
          config: Json
          created_at: string
          dataset_id: string | null
          epochs_completed: number
          epochs_total: number
          error_message: string | null
          id: string
          metrics: Json | null
          model_type: string
          name: string
          progress: number
          started_at: string | null
          status: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          config?: Json
          created_at?: string
          dataset_id?: string | null
          epochs_completed?: number
          epochs_total?: number
          error_message?: string | null
          id?: string
          metrics?: Json | null
          model_type?: string
          name: string
          progress?: number
          started_at?: string | null
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          config?: Json
          created_at?: string
          dataset_id?: string | null
          epochs_completed?: number
          epochs_total?: number
          error_message?: string | null
          id?: string
          metrics?: Json | null
          model_type?: string
          name?: string
          progress?: number
          started_at?: string | null
          status?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      training_metrics: {
        Row: {
          accuracy: number | null
          epoch: number
          f1_score: number | null
          id: string
          job_id: string
          learning_rate: number | null
          recorded_at: string
          tenant_id: string | null
          train_loss: number | null
          val_loss: number | null
        }
        Insert: {
          accuracy?: number | null
          epoch: number
          f1_score?: number | null
          id?: string
          job_id: string
          learning_rate?: number | null
          recorded_at?: string
          tenant_id?: string | null
          train_loss?: number | null
          val_loss?: number | null
        }
        Update: {
          accuracy?: number | null
          epoch?: number
          f1_score?: number | null
          id?: string
          job_id?: string
          learning_rate?: number | null
          recorded_at?: string
          tenant_id?: string | null
          train_loss?: number | null
          val_loss?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "training_metrics_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "training_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_metrics_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_tenant_ids: { Args: { _user_id: string }; Returns: string[] }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_tenant_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _tenant_id: string
          _user_id: string
        }
        Returns: boolean
      }
      is_tenant_member: {
        Args: { _tenant_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "owner" | "admin" | "member" | "viewer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["owner", "admin", "member", "viewer"],
    },
  },
} as const
