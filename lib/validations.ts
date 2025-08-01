import { z } from 'zod'

// Query parameter schemas
export const paginationSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
})

export const sortSchema = z.object({
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
})

// Laundry performance query schema
export const laundryPerformanceQuerySchema = paginationSchema.merge(sortSchema).extend({
  sortBy: z.enum(['ordersMonth', 'customers', 'revenue', 'rating']).optional(),
})

// Order query schemas
export const orderQuerySchema = paginationSchema.extend({
  search: z.string().optional(),
  status: z.enum(['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELED', 'REFUNDED']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
})

// Review query schema
export const reviewQuerySchema = paginationSchema.extend({
  rating: z.coerce.number().min(1).max(5).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
})

// Laundry update schema
export const laundryUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  description: z.string().optional(),
  logo: z.string().url().optional(),
  operatingHours: z.record(z.object({
    open: z.string(),
    close: z.string(),
    closed: z.boolean()
  })).optional(),
})

// Utility function to validate query parameters
export function validateQuery<T>(schema: z.ZodSchema<T>, query: any): T | null {
  try {
    return schema.parse(query)
  } catch (error) {
    return null
  }
}