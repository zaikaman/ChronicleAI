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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      daily_digests: {
        Row: {
          analysis: string | null
          audience: string
          content_uri: string | null
          created_at: string
          highlights: Json
          id: string
          period_end: string
          period_start: string
          publication_status: string
          published_at: string | null
          registry_tx_hash: string | null
          report_date: string
          source_event_ids: string[]
          source_event_root: string | null
          summary: string
          title: string
          updated_at: string
        }
        Insert: {
          analysis?: string | null
          audience?: string
          content_uri?: string | null
          created_at?: string
          highlights?: Json
          id?: string
          period_end: string
          period_start: string
          publication_status?: string
          published_at?: string | null
          registry_tx_hash?: string | null
          report_date: string
          source_event_ids?: string[]
          source_event_root?: string | null
          summary: string
          title: string
          updated_at?: string
        }
        Update: {
          analysis?: string | null
          audience?: string
          content_uri?: string | null
          created_at?: string
          highlights?: Json
          id?: string
          period_end?: string
          period_start?: string
          publication_status?: string
          published_at?: string | null
          registry_tx_hash?: string | null
          report_date?: string
          source_event_ids?: string[]
          source_event_root?: string | null
          summary?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      execution_logs: {
        Row: {
          action_type: string
          completed_at: string | null
          created_at: string
          details: Json
          entity_id: string | null
          entity_type: string | null
          id: string
          message: string | null
          started_at: string
          status: string
        }
        Insert: {
          action_type: string
          completed_at?: string | null
          created_at?: string
          details?: Json
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          message?: string | null
          started_at?: string
          status: string
        }
        Update: {
          action_type?: string
          completed_at?: string | null
          created_at?: string
          details?: Json
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          message?: string | null
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      llm_generation_attempts: {
        Row: {
          attempt_order: number
          created_at: string
          entity_id: string | null
          entity_type: string
          failure_reason: string | null
          id: string
          latency_ms: number
          monitored_event_id: string
          provider: string
          response_metadata: Json | null
          status: string
        }
        Insert: {
          attempt_order: number
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          failure_reason?: string | null
          id?: string
          latency_ms?: number
          monitored_event_id: string
          provider: string
          response_metadata?: Json | null
          status: string
        }
        Update: {
          attempt_order?: number
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          failure_reason?: string | null
          id?: string
          latency_ms?: number
          monitored_event_id?: string
          provider?: string
          response_metadata?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "llm_generation_attempts_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "public_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "llm_generation_attempts_monitored_event_id_fkey"
            columns: ["monitored_event_id"]
            isOneToOne: false
            referencedRelation: "monitored_events"
            referencedColumns: ["id"]
          },
        ]
      }
      monitored_events: {
        Row: {
          asset_symbols: string[] | null
          captured_at: string
          chain_id: number
          created_at: string
          event_type: string
          id: string
          magnitude: Json | null
          observed_at: string | null
          protocol: string | null
          raw_payload: Json
          significance_score: number | null
          source: string
          source_event_id: string | null
          status: string
          transaction_hash: string | null
          updated_at: string
        }
        Insert: {
          asset_symbols?: string[] | null
          captured_at: string
          chain_id: number
          created_at?: string
          event_type: string
          id?: string
          magnitude?: Json | null
          observed_at?: string | null
          protocol?: string | null
          raw_payload: Json
          significance_score?: number | null
          source: string
          source_event_id?: string | null
          status?: string
          transaction_hash?: string | null
          updated_at?: string
        }
        Update: {
          asset_symbols?: string[] | null
          captured_at?: string
          chain_id?: number
          created_at?: string
          event_type?: string
          id?: string
          magnitude?: Json | null
          observed_at?: string | null
          protocol?: string | null
          raw_payload?: Json
          significance_score?: number | null
          source?: string
          source_event_id?: string | null
          status?: string
          transaction_hash?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      payment_records: {
        Row: {
          amount_requested: number | null
          amount_settled: number | null
          challenge_reference: string | null
          created_at: string
          currency: string | null
          id: string
          payer_reference: string | null
          payment_route: string
          premium_item_id: string
          requested_at: string
          settled_at: string | null
          settlement_reference: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount_requested?: number | null
          amount_settled?: number | null
          challenge_reference?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          payer_reference?: string | null
          payment_route: string
          premium_item_id: string
          requested_at?: string
          settled_at?: string | null
          settlement_reference?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount_requested?: number | null
          amount_settled?: number | null
          challenge_reference?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          payer_reference?: string | null
          payment_route?: string
          premium_item_id?: string
          requested_at?: string
          settled_at?: string | null
          settlement_reference?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_records_premium_item_id_fkey"
            columns: ["premium_item_id"]
            isOneToOne: false
            referencedRelation: "premium_intelligence_items"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_records: {
        Row: {
          amount: number
          created_at: string
          id: string
          payout_period_hash: string
          payout_tx_hash: string | null
          reason_hash: string
          recipient: string
          registry_tx_hash: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          payout_period_hash: string
          payout_tx_hash?: string | null
          reason_hash: string
          recipient: string
          registry_tx_hash?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          payout_period_hash?: string
          payout_tx_hash?: string | null
          reason_hash?: string
          recipient?: string
          registry_tx_hash?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      premium_intelligence_items: {
        Row: {
          content_private: Json
          content_type: string
          created_at: string
          id: string
          payment_routes: string[]
          price_amount: number
          price_currency: string
          slug: string
          source_event_ids: string[]
          status: string
          summary_public: string
          title: string
          updated_at: string
        }
        Insert: {
          content_private?: Json
          content_type: string
          created_at?: string
          id?: string
          payment_routes?: string[]
          price_amount: number
          price_currency?: string
          slug: string
          source_event_ids?: string[]
          status?: string
          summary_public: string
          title: string
          updated_at?: string
        }
        Update: {
          content_private?: Json
          content_type?: string
          created_at?: string
          id?: string
          payment_routes?: string[]
          price_amount?: number
          price_currency?: string
          slug?: string
          source_event_ids?: string[]
          status?: string
          summary_public?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      public_alerts: {
        Row: {
          audience: string
          confidence: string | null
          content_uri: string | null
          created_at: string
          dedupe_key: string | null
          delivery_status: string
          destinations: Json | null
          generation_attempt_ids: string[]
          generation_provider: string | null
          id: string
          monitored_event_id: string | null
          published_at: string | null
          registry_tx_hash: string | null
          source_event_hash: string | null
          source_references: Json
          summary: string
          title: string
          updated_at: string
        }
        Insert: {
          audience?: string
          confidence?: string | null
          content_uri?: string | null
          created_at?: string
          dedupe_key?: string | null
          delivery_status?: string
          destinations?: Json | null
          generation_attempt_ids?: string[]
          generation_provider?: string | null
          id?: string
          monitored_event_id?: string | null
          published_at?: string | null
          registry_tx_hash?: string | null
          source_event_hash?: string | null
          source_references?: Json
          summary: string
          title: string
          updated_at?: string
        }
        Update: {
          audience?: string
          confidence?: string | null
          content_uri?: string | null
          created_at?: string
          dedupe_key?: string | null
          delivery_status?: string
          destinations?: Json | null
          generation_attempt_ids?: string[]
          generation_provider?: string | null
          id?: string
          monitored_event_id?: string | null
          published_at?: string | null
          registry_tx_hash?: string | null
          source_event_hash?: string | null
          source_references?: Json
          summary?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "public_alerts_monitored_event_id_fkey"
            columns: ["monitored_event_id"]
            isOneToOne: false
            referencedRelation: "monitored_events"
            referencedColumns: ["id"]
          },
        ]
      }
      sponsored_watches: {
        Row: {
          content_uri: string | null
          create_tx_hash: string | null
          created_at: string
          ends_at: string
          id: string
          report_content_hash: string | null
          report_tx_hash: string | null
          starts_at: string
          status: string
          target_contract: string
          updated_at: string
          watch_spec_hash: string
        }
        Insert: {
          content_uri?: string | null
          create_tx_hash?: string | null
          created_at?: string
          ends_at: string
          id?: string
          report_content_hash?: string | null
          report_tx_hash?: string | null
          starts_at: string
          status?: string
          target_contract: string
          updated_at?: string
          watch_spec_hash: string
        }
        Update: {
          content_uri?: string | null
          create_tx_hash?: string | null
          created_at?: string
          ends_at?: string
          id?: string
          report_content_hash?: string | null
          report_tx_hash?: string | null
          starts_at?: string
          status?: string
          target_contract?: string
          updated_at?: string
          watch_spec_hash?: string
        }
        Relationships: []
      }
      treasury_snapshots: {
        Row: {
          available_balance: number
          captured_at: string
          created_at: string
          currency: string
          estimated_generation_cost: number | null
          estimated_transaction_cost: number | null
          id: string
          last_payout_period_hash: string | null
          last_routed_at: string | null
          paid_request_count: number | null
          revenue_total: number | null
          safety_buffer: number
          status: string
          total_routed_amount: number | null
        }
        Insert: {
          available_balance: number
          captured_at: string
          created_at?: string
          currency?: string
          estimated_generation_cost?: number | null
          estimated_transaction_cost?: number | null
          id?: string
          last_payout_period_hash?: string | null
          last_routed_at?: string | null
          paid_request_count?: number | null
          revenue_total?: number | null
          safety_buffer: number
          status?: string
          total_routed_amount?: number | null
        }
        Update: {
          available_balance?: number
          captured_at?: string
          created_at?: string
          currency?: string
          estimated_generation_cost?: number | null
          estimated_transaction_cost?: number | null
          id?: string
          last_payout_period_hash?: string | null
          last_routed_at?: string | null
          paid_request_count?: number | null
          revenue_total?: number | null
          safety_buffer?: number
          status?: string
          total_routed_amount?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
