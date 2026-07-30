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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      affiliate_agent_jobs: {
        Row: {
          affiliate_wallet: string
          created_at: string
          error: string | null
          id: string
          request: Json
          result: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          affiliate_wallet: string
          created_at?: string
          error?: string | null
          id: string
          request: Json
          result?: Json | null
          status: string
          updated_at?: string
        }
        Update: {
          affiliate_wallet?: string
          created_at?: string
          error?: string | null
          id?: string
          request?: Json
          result?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      affiliate_earnings: {
        Row: {
          affiliate_wallet: string
          created_at: string
          currency: string
          id: string
          payment_amount: number
          payment_record_id: string
          referred_wallet: string
          reward_amount: number
          reward_share: number
        }
        Insert: {
          affiliate_wallet: string
          created_at?: string
          currency?: string
          id?: string
          payment_amount: number
          payment_record_id: string
          referred_wallet: string
          reward_amount: number
          reward_share: number
        }
        Update: {
          affiliate_wallet?: string
          created_at?: string
          currency?: string
          id?: string
          payment_amount?: number
          payment_record_id?: string
          referred_wallet?: string
          reward_amount?: number
          reward_share?: number
        }
        Relationships: []
      }
      affiliate_withdrawals: {
        Row: {
          affiliate_wallet: string
          agent_message: string | null
          amount: number
          completed_at: string | null
          created_at: string
          currency: string
          error_message: string | null
          explorer_url: string | null
          id: string
          keeper_hub_run_id: string | null
          payout_record_id: string | null
          payout_tx_hash: string | null
          registry_tx_hash: string | null
          status: string
          updated_at: string
        }
        Insert: {
          affiliate_wallet: string
          agent_message?: string | null
          amount: number
          completed_at?: string | null
          created_at?: string
          currency?: string
          error_message?: string | null
          explorer_url?: string | null
          id?: string
          keeper_hub_run_id?: string | null
          payout_record_id?: string | null
          payout_tx_hash?: string | null
          registry_tx_hash?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          affiliate_wallet?: string
          agent_message?: string | null
          amount?: number
          completed_at?: string | null
          created_at?: string
          currency?: string
          error_message?: string | null
          explorer_url?: string | null
          id?: string
          keeper_hub_run_id?: string | null
          payout_record_id?: string | null
          payout_tx_hash?: string | null
          registry_tx_hash?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      affiliates: {
        Row: {
          approved_at: string | null
          created_at: string
          display_name: string | null
          id: string
          metadata: Json
          referral_code: string | null
          status: string
          updated_at: string
          wallet_address: string
        }
        Insert: {
          approved_at?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          metadata?: Json
          referral_code?: string | null
          status?: string
          updated_at?: string
          wallet_address: string
        }
        Update: {
          approved_at?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          metadata?: Json
          referral_code?: string | null
          status?: string
          updated_at?: string
          wallet_address?: string
        }
        Relationships: []
      }
      cctp_rebalance_transfers: {
        Row: {
          amount_atomic: string
          amount_usdc: number
          approve_tx_hash: string | null
          attempt_count: number
          attestation: string | null
          attested_at: string | null
          burn_tx_hash: string | null
          burned_at: string | null
          created_at: string
          destination_chain_id: number
          destination_domain: number
          direction: string
          error_message: string | null
          id: string
          iris_status: string | null
          max_fee_atomic: string | null
          message_bytes: string | null
          message_hash: string | null
          metadata: Json
          min_finality_threshold: number | null
          mint_recipient: string
          mint_tx_hash: string | null
          minted_at: string | null
          mode: string
          source_chain_id: number
          source_domain: number
          status: string
          treasury_address: string
          updated_at: string
        }
        Insert: {
          amount_atomic: string
          amount_usdc: number
          approve_tx_hash?: string | null
          attempt_count?: number
          attestation?: string | null
          attested_at?: string | null
          burn_tx_hash?: string | null
          burned_at?: string | null
          created_at?: string
          destination_chain_id?: number
          destination_domain?: number
          direction?: string
          error_message?: string | null
          id?: string
          iris_status?: string | null
          max_fee_atomic?: string | null
          message_bytes?: string | null
          message_hash?: string | null
          metadata?: Json
          min_finality_threshold?: number | null
          mint_recipient: string
          mint_tx_hash?: string | null
          minted_at?: string | null
          mode: string
          source_chain_id?: number
          source_domain?: number
          status?: string
          treasury_address: string
          updated_at?: string
        }
        Update: {
          amount_atomic?: string
          amount_usdc?: number
          approve_tx_hash?: string | null
          attempt_count?: number
          attestation?: string | null
          attested_at?: string | null
          burn_tx_hash?: string | null
          burned_at?: string | null
          created_at?: string
          destination_chain_id?: number
          destination_domain?: number
          direction?: string
          error_message?: string | null
          id?: string
          iris_status?: string | null
          max_fee_atomic?: string | null
          message_bytes?: string | null
          message_hash?: string | null
          metadata?: Json
          min_finality_threshold?: number | null
          mint_recipient?: string
          mint_tx_hash?: string | null
          minted_at?: string | null
          mode?: string
          source_chain_id?: number
          source_domain?: number
          status?: string
          treasury_address?: string
          updated_at?: string
        }
        Relationships: []
      }
      daily_digests: {
        Row: {
          analysis: string | null
          audience: string
          content_hash: string | null
          content_uri: string | null
          created_at: string
          explorer_url: string | null
          gas_used: string | null
          gas_used_wei: string | null
          highlights: Json
          id: string
          image_prompt: string | null
          image_provider: string | null
          image_status: string | null
          image_url: string | null
          keeper_hub_run_id: string | null
          market_narrative: Json | null
          market_narrative_provider: string | null
          market_narrative_status: string | null
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
          content_hash?: string | null
          content_uri?: string | null
          created_at?: string
          explorer_url?: string | null
          gas_used?: string | null
          gas_used_wei?: string | null
          highlights?: Json
          id?: string
          image_prompt?: string | null
          image_provider?: string | null
          image_status?: string | null
          image_url?: string | null
          keeper_hub_run_id?: string | null
          market_narrative?: Json | null
          market_narrative_provider?: string | null
          market_narrative_status?: string | null
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
          content_hash?: string | null
          content_uri?: string | null
          created_at?: string
          explorer_url?: string | null
          gas_used?: string | null
          gas_used_wei?: string | null
          highlights?: Json
          id?: string
          image_prompt?: string | null
          image_provider?: string | null
          image_status?: string | null
          image_url?: string | null
          keeper_hub_run_id?: string | null
          market_narrative?: Json | null
          market_narrative_provider?: string | null
          market_narrative_status?: string | null
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
      desk_agent_runs: {
        Row: {
          context_digest: Json
          created_at: string
          error_message: string | null
          id: string
          intent_id: string | null
          latency_ms: number | null
          model: string | null
          proposal: Json
        }
        Insert: {
          context_digest?: Json
          created_at?: string
          error_message?: string | null
          id?: string
          intent_id?: string | null
          latency_ms?: number | null
          model?: string | null
          proposal?: Json
        }
        Update: {
          context_digest?: Json
          created_at?: string
          error_message?: string | null
          id?: string
          intent_id?: string | null
          latency_ms?: number | null
          model?: string | null
          proposal?: Json
        }
        Relationships: [
          {
            foreignKeyName: "desk_agent_runs_intent_id_fkey"
            columns: ["intent_id"]
            isOneToOne: false
            referencedRelation: "desk_intents"
            referencedColumns: ["id"]
          },
        ]
      }
      desk_capital_moves: {
        Row: {
          amount_usdc: number
          created_at: string
          desk_equity_after: number | null
          direction: string
          explorer_url: string | null
          from_address: string
          id: string
          keeper_hub_run_id: string | null
          reason: string | null
          registry_explorer_url: string | null
          registry_tx_hash: string | null
          to_address: string
          treasury_usdc_after: number | null
          tx_hash: string | null
        }
        Insert: {
          amount_usdc: number
          created_at?: string
          desk_equity_after?: number | null
          direction: string
          explorer_url?: string | null
          from_address: string
          id?: string
          keeper_hub_run_id?: string | null
          reason?: string | null
          registry_explorer_url?: string | null
          registry_tx_hash?: string | null
          to_address: string
          treasury_usdc_after?: number | null
          tx_hash?: string | null
        }
        Update: {
          amount_usdc?: number
          created_at?: string
          desk_equity_after?: number | null
          direction?: string
          explorer_url?: string | null
          from_address?: string
          id?: string
          keeper_hub_run_id?: string | null
          reason?: string | null
          registry_explorer_url?: string | null
          registry_tx_hash?: string | null
          to_address?: string
          treasury_usdc_after?: number | null
          tx_hash?: string | null
        }
        Relationships: []
      }
      desk_control_state: {
        Row: {
          desk_paused: boolean
          id: string
          kill_armed: boolean
          kill_armed_at: string | null
          kill_armed_reason: string | null
          last_event_microtrade_at: string | null
          last_keeper_hub_run_id: string | null
          last_maintenance_at: string | null
          last_trip_at: string | null
          last_trip_reason: string | null
          last_tx_hash: string | null
          updated_at: string
        }
        Insert: {
          desk_paused?: boolean
          id?: string
          kill_armed?: boolean
          kill_armed_at?: string | null
          kill_armed_reason?: string | null
          last_event_microtrade_at?: string | null
          last_keeper_hub_run_id?: string | null
          last_maintenance_at?: string | null
          last_trip_at?: string | null
          last_trip_reason?: string | null
          last_tx_hash?: string | null
          updated_at?: string
        }
        Update: {
          desk_paused?: boolean
          id?: string
          kill_armed?: boolean
          kill_armed_at?: string | null
          kill_armed_reason?: string | null
          last_event_microtrade_at?: string | null
          last_keeper_hub_run_id?: string | null
          last_maintenance_at?: string | null
          last_trip_at?: string | null
          last_trip_reason?: string | null
          last_tx_hash?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      desk_heartbeats: {
        Row: {
          created_at: string
          id: string
          source: string
        }
        Insert: {
          created_at?: string
          id?: string
          source: string
        }
        Update: {
          created_at?: string
          id?: string
          source?: string
        }
        Relationships: []
      }
      desk_intents: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          keeper_hub_run_id: string | null
          legs: Json
          notional_usdc: number
          policy_snapshot: Json
          reason_codes: string[]
          signal_id: string | null
          status: string
          strategy: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          keeper_hub_run_id?: string | null
          legs?: Json
          notional_usdc?: number
          policy_snapshot?: Json
          reason_codes?: string[]
          signal_id?: string | null
          status?: string
          strategy: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          keeper_hub_run_id?: string | null
          legs?: Json
          notional_usdc?: number
          policy_snapshot?: Json
          reason_codes?: string[]
          signal_id?: string | null
          status?: string
          strategy?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "desk_intents_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "desk_signals"
            referencedColumns: ["id"]
          },
        ]
      }
      desk_positions: {
        Row: {
          aave: Json
          as_of: string
          created_at: string
          desk_address: string
          equity_usdc: number
          id: string
          lido: Json | null
          link: number
          morpho: Json | null
          raw: Json
          usdc: number
          weth: number
        }
        Insert: {
          aave?: Json
          as_of: string
          created_at?: string
          desk_address: string
          equity_usdc?: number
          id?: string
          lido?: Json | null
          link?: number
          morpho?: Json | null
          raw?: Json
          usdc?: number
          weth?: number
        }
        Update: {
          aave?: Json
          as_of?: string
          created_at?: string
          desk_address?: string
          equity_usdc?: number
          id?: string
          lido?: Json | null
          link?: number
          morpho?: Json | null
          raw?: Json
          usdc?: number
          weth?: number
        }
        Relationships: []
      }
      desk_signals: {
        Row: {
          chain_id: number
          created_at: string
          dedupe_key: string
          features: Json
          id: string
          policy_verdict: string
          severity: number
          signal_type: string
          sources: Json
        }
        Insert: {
          chain_id?: number
          created_at?: string
          dedupe_key: string
          features?: Json
          id?: string
          policy_verdict?: string
          severity?: number
          signal_type: string
          sources?: Json
        }
        Update: {
          chain_id?: number
          created_at?: string
          dedupe_key?: string
          features?: Json
          id?: string
          policy_verdict?: string
          severity?: number
          signal_type?: string
          sources?: Json
        }
        Relationships: []
      }
      desk_tickets: {
        Row: {
          content_uri: string | null
          created_at: string
          explorer_url: string | null
          id: string
          intent_hash: string | null
          intent_id: string
          keeper_hub_run_id: string | null
          payload: Json
          signal_hash: string | null
          summary: string | null
          ticket_hash: string
          tx_hash: string | null
        }
        Insert: {
          content_uri?: string | null
          created_at?: string
          explorer_url?: string | null
          id?: string
          intent_hash?: string | null
          intent_id: string
          keeper_hub_run_id?: string | null
          payload?: Json
          signal_hash?: string | null
          summary?: string | null
          ticket_hash: string
          tx_hash?: string | null
        }
        Update: {
          content_uri?: string | null
          created_at?: string
          explorer_url?: string | null
          id?: string
          intent_hash?: string | null
          intent_id?: string
          keeper_hub_run_id?: string | null
          payload?: Json
          signal_hash?: string | null
          summary?: string | null
          ticket_hash?: string
          tx_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "desk_tickets_intent_id_fkey"
            columns: ["intent_id"]
            isOneToOne: false
            referencedRelation: "desk_intents"
            referencedColumns: ["id"]
          },
        ]
      }
      email_subscribers: {
        Row: {
          created_at: string
          email: string
          email_normalized: string
          id: string
          payer_reference: string | null
          receives_alerts: boolean
          receives_digests: boolean
          source: string
          status: string
          subscribed_at: string
          unsubscribe_token: string
          unsubscribed_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          email_normalized: string
          id?: string
          payer_reference?: string | null
          receives_alerts?: boolean
          receives_digests?: boolean
          source?: string
          status?: string
          subscribed_at?: string
          unsubscribe_token?: string
          unsubscribed_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          email_normalized?: string
          id?: string
          payer_reference?: string | null
          receives_alerts?: boolean
          receives_digests?: boolean
          source?: string
          status?: string
          subscribed_at?: string
          unsubscribe_token?: string
          unsubscribed_at?: string | null
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
          monitored_event_id: string | null
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
          monitored_event_id?: string | null
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
          monitored_event_id?: string | null
          provider?: string
          response_metadata?: Json | null
          status?: string
        }
        Relationships: [
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
          content_uri: string | null
          created_at: string
          currency: string | null
          expires_at: string | null
          explorer_url: string | null
          id: string
          keeper_hub_run_id: string | null
          payer_reference: string | null
          payment_route: string
          premium_item_id: string
          referral_address: string | null
          registry_tx_hash: string | null
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
          content_uri?: string | null
          created_at?: string
          currency?: string | null
          expires_at?: string | null
          explorer_url?: string | null
          id?: string
          keeper_hub_run_id?: string | null
          payer_reference?: string | null
          payment_route: string
          premium_item_id: string
          referral_address?: string | null
          registry_tx_hash?: string | null
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
          content_uri?: string | null
          created_at?: string
          currency?: string | null
          expires_at?: string | null
          explorer_url?: string | null
          id?: string
          keeper_hub_run_id?: string | null
          payer_reference?: string | null
          payment_route?: string
          premium_item_id?: string
          referral_address?: string | null
          registry_tx_hash?: string | null
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
          explorer_url: string | null
          id: string
          keeper_hub_run_id: string | null
          payout_period_hash: string
          payout_tx_hash: string | null
          reason_hash: string
          recipient: string
          registry_tx_hash: string | null
          status: string
          transfer_explorer_url: string | null
          transfer_keeper_hub_run_id: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          explorer_url?: string | null
          id?: string
          keeper_hub_run_id?: string | null
          payout_period_hash: string
          payout_tx_hash?: string | null
          reason_hash: string
          recipient: string
          registry_tx_hash?: string | null
          status?: string
          transfer_explorer_url?: string | null
          transfer_keeper_hub_run_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          explorer_url?: string | null
          id?: string
          keeper_hub_run_id?: string | null
          payout_period_hash?: string
          payout_tx_hash?: string | null
          reason_hash?: string
          recipient?: string
          registry_tx_hash?: string | null
          status?: string
          transfer_explorer_url?: string | null
          transfer_keeper_hub_run_id?: string | null
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
          content_hash: string | null
          content_uri: string | null
          created_at: string
          dedupe_key: string | null
          delivery_status: string
          destinations: Json | null
          explorer_url: string | null
          gas_used: string | null
          gas_used_wei: string | null
          generation_attempt_ids: string[]
          generation_provider: string | null
          id: string
          keeper_hub_run_id: string | null
          market_chatter: Json | null
          market_chatter_provider: string | null
          market_chatter_status: string | null
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
          content_hash?: string | null
          content_uri?: string | null
          created_at?: string
          dedupe_key?: string | null
          delivery_status?: string
          destinations?: Json | null
          explorer_url?: string | null
          gas_used?: string | null
          gas_used_wei?: string | null
          generation_attempt_ids?: string[]
          generation_provider?: string | null
          id?: string
          keeper_hub_run_id?: string | null
          market_chatter?: Json | null
          market_chatter_provider?: string | null
          market_chatter_status?: string | null
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
          content_hash?: string | null
          content_uri?: string | null
          created_at?: string
          dedupe_key?: string | null
          delivery_status?: string
          destinations?: Json | null
          explorer_url?: string | null
          gas_used?: string | null
          gas_used_wei?: string | null
          generation_attempt_ids?: string[]
          generation_provider?: string | null
          id?: string
          keeper_hub_run_id?: string | null
          market_chatter?: Json | null
          market_chatter_provider?: string | null
          market_chatter_status?: string | null
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
      referral_attributions: {
        Row: {
          affiliate_wallet: string
          attributed_at: string
          created_at: string
          id: string
          referral_code: string | null
          referred_wallet: string
          source: string
          updated_at: string
        }
        Insert: {
          affiliate_wallet: string
          attributed_at?: string
          created_at?: string
          id?: string
          referral_code?: string | null
          referred_wallet: string
          source?: string
          updated_at?: string
        }
        Update: {
          affiliate_wallet?: string
          attributed_at?: string
          created_at?: string
          id?: string
          referral_code?: string | null
          referred_wallet?: string
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      sponsored_watches: {
        Row: {
          content_uri: string | null
          create_explorer_url: string | null
          create_keeper_hub_run_id: string | null
          create_tx_hash: string | null
          created_at: string
          ends_at: string
          id: string
          last_monitored_at: string | null
          monitored_event_count: number
          on_chain_watch_id: number | null
          report_analysis: string | null
          report_content_hash: string | null
          report_explorer_url: string | null
          report_highlights: Json
          report_keeper_hub_run_id: string | null
          report_summary: string | null
          report_title: string | null
          report_tx_hash: string | null
          source_event_ids: string[]
          source_event_root: string | null
          starts_at: string
          status: string
          target_contract: string
          updated_at: string
          watch_spec_hash: string
        }
        Insert: {
          content_uri?: string | null
          create_explorer_url?: string | null
          create_keeper_hub_run_id?: string | null
          create_tx_hash?: string | null
          created_at?: string
          ends_at: string
          id?: string
          last_monitored_at?: string | null
          monitored_event_count?: number
          on_chain_watch_id?: number | null
          report_analysis?: string | null
          report_content_hash?: string | null
          report_explorer_url?: string | null
          report_highlights?: Json
          report_keeper_hub_run_id?: string | null
          report_summary?: string | null
          report_title?: string | null
          report_tx_hash?: string | null
          source_event_ids?: string[]
          source_event_root?: string | null
          starts_at: string
          status?: string
          target_contract: string
          updated_at?: string
          watch_spec_hash: string
        }
        Update: {
          content_uri?: string | null
          create_explorer_url?: string | null
          create_keeper_hub_run_id?: string | null
          create_tx_hash?: string | null
          created_at?: string
          ends_at?: string
          id?: string
          last_monitored_at?: string | null
          monitored_event_count?: number
          on_chain_watch_id?: number | null
          report_analysis?: string | null
          report_content_hash?: string | null
          report_explorer_url?: string | null
          report_highlights?: Json
          report_keeper_hub_run_id?: string | null
          report_summary?: string | null
          report_title?: string | null
          report_tx_hash?: string | null
          source_event_ids?: string[]
          source_event_root?: string | null
          starts_at?: string
          status?: string
          target_contract?: string
          updated_at?: string
          watch_spec_hash?: string
        }
        Relationships: []
      }
      system_control_state: {
        Row: {
          groq_key_index: number
          id: string
          updated_at: string
        }
        Insert: {
          groq_key_index?: number
          id?: string
          updated_at?: string
        }
        Update: {
          groq_key_index?: number
          id?: string
          updated_at?: string
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
      x402_newsletter_subscriptions: {
        Row: {
          amount_per_period: number
          billing_period_days: number
          cancel_at_period_end: boolean
          cancelled_at: string | null
          created_at: string
          currency: string
          current_period_end: string | null
          current_period_start: string | null
          email: string
          email_normalized: string
          email_subscriber_id: string | null
          grace_period_days: number
          id: string
          last_payment_record_id: string | null
          last_settled_at: string | null
          last_settlement_reference: string | null
          next_renewal_at: string | null
          payer_wallet: string | null
          pending_challenge_reference: string | null
          pending_payment_record_id: string | null
          periods_paid: number
          premium_item_id: string | null
          referral_address: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount_per_period: number
          billing_period_days?: number
          cancel_at_period_end?: boolean
          cancelled_at?: string | null
          created_at?: string
          currency?: string
          current_period_end?: string | null
          current_period_start?: string | null
          email: string
          email_normalized: string
          email_subscriber_id?: string | null
          grace_period_days?: number
          id?: string
          last_payment_record_id?: string | null
          last_settled_at?: string | null
          last_settlement_reference?: string | null
          next_renewal_at?: string | null
          payer_wallet?: string | null
          pending_challenge_reference?: string | null
          pending_payment_record_id?: string | null
          periods_paid?: number
          premium_item_id?: string | null
          referral_address?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount_per_period?: number
          billing_period_days?: number
          cancel_at_period_end?: boolean
          cancelled_at?: string | null
          created_at?: string
          currency?: string
          current_period_end?: string | null
          current_period_start?: string | null
          email?: string
          email_normalized?: string
          email_subscriber_id?: string | null
          grace_period_days?: number
          id?: string
          last_payment_record_id?: string | null
          last_settled_at?: string | null
          last_settlement_reference?: string | null
          next_renewal_at?: string | null
          payer_wallet?: string | null
          pending_challenge_reference?: string | null
          pending_payment_record_id?: string | null
          periods_paid?: number
          premium_item_id?: string | null
          referral_address?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "x402_newsletter_subscriptions_email_subscriber_id_fkey"
            columns: ["email_subscriber_id"]
            isOneToOne: false
            referencedRelation: "email_subscribers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "x402_newsletter_subscriptions_last_payment_record_id_fkey"
            columns: ["last_payment_record_id"]
            isOneToOne: false
            referencedRelation: "payment_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "x402_newsletter_subscriptions_pending_payment_record_id_fkey"
            columns: ["pending_payment_record_id"]
            isOneToOne: false
            referencedRelation: "payment_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "x402_newsletter_subscriptions_premium_item_id_fkey"
            columns: ["premium_item_id"]
            isOneToOne: false
            referencedRelation: "premium_intelligence_items"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      activity_referral_attribution: { Args: never; Returns: Json }
      activity_subscription_analytics: { Args: never; Returns: Json }
      prune_desk_heartbeats: { Args: { keep_count?: number }; Returns: number }
      prune_desk_positions: { Args: { keep_count?: number }; Returns: number }
      sum_affiliate_earned: {
        Args: { p_affiliate_wallet: string }
        Returns: number
      }
      sum_affiliate_withdrawals: {
        Args: { p_affiliate_wallet: string; p_statuses: string[] }
        Returns: number
      }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
