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
      business_hours: {
        Row: {
          close_time: string | null
          is_open: boolean
          open_time: string | null
          weekday: number
        }
        Insert: {
          close_time?: string | null
          is_open?: boolean
          open_time?: string | null
          weekday: number
        }
        Update: {
          close_time?: string | null
          is_open?: boolean
          open_time?: string | null
          weekday?: number
        }
        Relationships: []
      }
      customers: {
        Row: {
          created_at: string
          id: string
          line_user_id: string | null
          name: string
          note: string | null
          phone: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          line_user_id?: string | null
          name: string
          note?: string | null
          phone?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          line_user_id?: string | null
          name?: string
          note?: string | null
          phone?: string | null
        }
        Relationships: []
      }
      date_overrides: {
        Row: {
          close_time: string | null
          created_at: string
          end_date: string
          id: string
          is_open: boolean
          label: string | null
          open_time: string | null
          start_date: string
        }
        Insert: {
          close_time?: string | null
          created_at?: string
          end_date: string
          id?: string
          is_open?: boolean
          label?: string | null
          open_time?: string | null
          start_date: string
        }
        Update: {
          close_time?: string | null
          created_at?: string
          end_date?: string
          id?: string
          is_open?: boolean
          label?: string | null
          open_time?: string | null
          start_date?: string
        }
        Relationships: []
      }
      menu_categories: {
        Row: {
          created_at: string
          description: string | null
          display_order: number
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          display_order?: number
          id?: string
          name?: string
        }
        Relationships: []
      }
      menus: {
        Row: {
          category_id: string
          created_at: string
          display_order: number
          duration_minutes: number
          id: string
          is_active: boolean
          name: string
          price: number
        }
        Insert: {
          category_id: string
          created_at?: string
          display_order?: number
          duration_minutes: number
          id?: string
          is_active?: boolean
          name: string
          price: number
        }
        Update: {
          category_id?: string
          created_at?: string
          display_order?: number
          duration_minutes?: number
          id?: string
          is_active?: boolean
          name?: string
          price?: number
        }
        Relationships: [
          {
            foreignKeyName: "menus_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      nth_weekday_closures: {
        Row: {
          created_at: string
          id: string
          nth: number
          weekday: number
        }
        Insert: {
          created_at?: string
          id?: string
          nth: number
          weekday: number
        }
        Update: {
          created_at?: string
          id?: string
          nth?: number
          weekday?: number
        }
        Relationships: []
      }
      push_messages: {
        Row: {
          id: string
          reservation_id: string | null
          sent_at: string
          type: string
        }
        Insert: {
          id?: string
          reservation_id?: string | null
          sent_at?: string
          type: string
        }
        Update: {
          id?: string
          reservation_id?: string | null
          sent_at?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_messages_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      reservation_menus: {
        Row: {
          duration_minutes: number
          id: string
          menu_id: string | null
          menu_name: string
          price: number
          reservation_id: string
        }
        Insert: {
          duration_minutes: number
          id?: string
          menu_id?: string | null
          menu_name: string
          price: number
          reservation_id: string
        }
        Update: {
          duration_minutes?: number
          id?: string
          menu_id?: string | null
          menu_name?: string
          price?: number
          reservation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservation_menus_menu_id_fkey"
            columns: ["menu_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_menus_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      reservations: {
        Row: {
          cancelled_at: string | null
          created_at: string
          customer_id: string | null
          during: unknown
          id: string
          kind: string
          note: string | null
          source: string
          staff_id: string
          status: string
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string
          customer_id?: string | null
          during: unknown
          id?: string
          kind?: string
          note?: string | null
          source?: string
          staff_id: string
          status?: string
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string
          customer_id?: string | null
          during?: unknown
          id?: string
          kind?: string
          note?: string | null
          source?: string
          staff_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      salon_settings: {
        Row: {
          booking_window_days: number
          cancel_deadline_minutes: number
          close_on_holidays: boolean
          created_at: string
          font_family: string
          id: boolean
          max_upcoming_reservations: number
          min_lead_minutes: number
          name: string
          reminder_hour: number
          slot_interval_minutes: number
          theme_preset: string
        }
        Insert: {
          booking_window_days?: number
          cancel_deadline_minutes?: number
          close_on_holidays?: boolean
          created_at?: string
          font_family?: string
          id?: boolean
          max_upcoming_reservations?: number
          min_lead_minutes?: number
          name: string
          reminder_hour?: number
          slot_interval_minutes?: number
          theme_preset?: string
        }
        Update: {
          booking_window_days?: number
          cancel_deadline_minutes?: number
          close_on_holidays?: boolean
          created_at?: string
          font_family?: string
          id?: boolean
          max_upcoming_reservations?: number
          min_lead_minutes?: number
          name?: string
          reminder_hour?: number
          slot_interval_minutes?: number
          theme_preset?: string
        }
        Relationships: []
      }
      staff: {
        Row: {
          auth_user_id: string | null
          bio: string | null
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          name: string
          photo_url: string | null
          role: string
        }
        Insert: {
          auth_user_id?: string | null
          bio?: string | null
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          name: string
          photo_url?: string | null
          role?: string
        }
        Update: {
          auth_user_id?: string | null
          bio?: string | null
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          name?: string
          photo_url?: string | null
          role?: string
        }
        Relationships: []
      }
      staff_working_hours: {
        Row: {
          break_end: string | null
          break_start: string | null
          end_time: string
          id: string
          staff_id: string
          start_time: string
          weekday: number
        }
        Insert: {
          break_end?: string | null
          break_start?: string | null
          end_time: string
          id?: string
          staff_id: string
          start_time: string
          weekday: number
        }
        Update: {
          break_end?: string | null
          break_start?: string | null
          end_time?: string
          id?: string
          staff_id?: string
          start_time?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "staff_working_hours_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _cancel_own_booking: {
        Args: { p_line_user_id: string; p_reservation_id: string }
        Returns: string
      }
      _insert_booking: {
        Args: {
          p_customer_id: string
          p_menu_ids: string[]
          p_note: string
          p_source?: string
          p_staff_id: string
          p_start: string
        }
        Returns: string
      }
      _validate_menus: {
        Args: { p_menu_ids: string[] }
        Returns: Record<string, unknown>
      }
      admin_create_reservation: {
        Args: {
          p_customer_id: string
          p_customer_name: string
          p_customer_phone: string
          p_menu_ids: string[]
          p_note: string
          p_staff_id: string
          p_start: string
        }
        Returns: string
      }
      admin_update_reservation: {
        Args: {
          p_menu_ids: string[]
          p_note: string
          p_reservation_id: string
          p_staff_id: string
          p_start: string
        }
        Returns: string
      }
      cancel_reservation: {
        Args: { p_line_user_id: string; p_reservation_id: string }
        Returns: string
      }
      change_reservation: {
        Args: {
          p_line_user_id: string
          p_menu_ids: string[]
          p_note: string
          p_reservation_id: string
          p_staff_id: string
          p_start: string
        }
        Returns: Json
      }
      create_reservation: {
        Args: {
          p_customer_name: string
          p_customer_phone: string
          p_line_user_id: string
          p_menu_ids: string[]
          p_note: string
          p_staff_id: string
          p_start: string
        }
        Returns: string
      }
      current_staff_role: { Args: never; Returns: string }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
