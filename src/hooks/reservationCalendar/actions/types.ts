/**
 * actions/types.ts
 * reservationActions 공유 의존성 타입 정의
 */
import type { Vehicle } from '../../../types/vehicle';
import type { UserRole } from '../../../types/user';
import type { Reservation, ReservationForm } from '../../../types/reservation';
import type { CustomHoliday } from '../../../types/holiday';
import type { Favorite } from '../../../types/favorite';
import type { RouteInfoData } from '../useRouteInfo';

// ─── Shared dependency types ─────────────────────────────────────

export interface ActionDeps {
    user: { uid: string; email?: string | null };
    userData: { organizationId?: string | null; name?: string; role?: UserRole };
    form: ReservationForm;
    selectedDate: string;
    currentMonth: Date;
    vehicles: Vehicle[];
    reservations: Reservation[];
    holidays: CustomHoliday[];
    routeInfo: RouteInfoData | null;
    reservationSource: string | null;
    editingReservation: Reservation | null;
    editingGroupId: string | null;
    editingRecurringGroupId: string | null;
    showToast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
    confirm: (opts: {
        title?: string;
        message: string;
        confirmText?: string;
        cancelText?: string;
        confirmColor?: 'primary' | 'danger' | 'warning';
    }) => Promise<boolean | string | null>;
    setSubmitting: (v: boolean) => void;
    setReservations: React.Dispatch<React.SetStateAction<Reservation[]>>;
    resetFormState: () => void;
    setRouteInfo: (v: RouteInfoData | null) => void;
}

export interface EditDeps {
    reservations: Reservation[];
    setEditingReservation: (r: Reservation | null) => void;
    setEditingGroupId: (id: string | null) => void;
    setEditingRecurringGroupId: (id: string | null) => void;
    setSelectedDate: (d: string) => void;
    setForm: React.Dispatch<React.SetStateAction<ReservationForm>>;
    setShowForm: (v: boolean) => void;
}

export interface CancelDeps {
    reservations: Reservation[];
    userData: { organizationId?: string | null } | null;
    showToast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
    confirm: (opts: {
        title?: string;
        message: string;
        confirmText?: string;
        cancelText?: string;
        confirmColor?: 'primary' | 'danger' | 'warning';
    }) => Promise<boolean | string | null>;
    setReservations: React.Dispatch<React.SetStateAction<Reservation[]>>;
}

export interface SaveFavoriteDeps {
    user: { uid: string };
    userData: { organizationId?: string | null } | null;
    form: ReservationForm;
    favName: string;
    showToast: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
    setFavorites: React.Dispatch<React.SetStateAction<Favorite[]>>;
    setShowFavSave: (v: boolean) => void;
    setFavName: (v: string) => void;
}
