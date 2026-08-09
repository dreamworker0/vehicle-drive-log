/**
 * 차량 (Vehicles) 타입
 *
 * 문서 모양의 원본은 `src/schemas/vehicle.ts`다 — 여기서는 파생만 한다.
 */
import type { z } from 'zod';
import type {
    vehicleSchema,
    vehicleRetiredSchema,
    vehicleMaintenanceSchema,
    vehicleTypeSchema,
    fuelTypeSchema,
} from '../schemas/vehicle';
import type { FirestoreDoc } from './common';

export type VehicleType = z.infer<typeof vehicleTypeSchema>;
export type FuelType = z.infer<typeof fuelTypeSchema>;

export const FUEL_TYPES: { id: FuelType; label: string }[] = [
    { id: 'gasoline', label: '가솔린' },
    { id: 'diesel', label: '디젤' },
    { id: 'lpg', label: 'LPG' },
    { id: 'electric', label: '전기' },
    { id: 'hydrogen', label: '수소' }
];

export type VehicleRetired = z.infer<typeof vehicleRetiredSchema>;
export type VehicleMaintenance = z.infer<typeof vehicleMaintenanceSchema>;

export type Vehicle = z.infer<typeof vehicleSchema> & FirestoreDoc;

/** createVehicle에 전달할 데이터 */
export type CreateVehicleData = Omit<Vehicle, 'id' | 'createdAt' | 'retired' | 'maintenance'>;
