// app/api/admin/orders/route.ts
import { prisma } from '@/lib/prisma'
import { successResponse, errorResponse } from '@/lib/response'
import { validateQuery } from '@/lib/validations'
import { NextRequest } from 'next/server'
import { z } from 'zod'

// Query schema for orders
const ordersQuerySchema = z.object({
  page: z.coerce.number().min(1).optional().default(1),
  limit: z.coerce.number().min(1).max(100).optional().default(20),
  status: z.string().optional(),
  service: z.string().optional(),
  search: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  sortBy: z.enum(['createdAt', 'finalAmount', 'status', 'orderNumber']).optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc')
})

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const laundryId = searchParams.get('laundryId')

    if (!laundryId) {
      return errorResponse('laundryId parameter is required', 400)
    }

    // Verify laundry exists
    const laundry = await prisma.laundry.findUnique({
      where: { id: laundryId }
    })

    if (!laundry) {
      return errorResponse('Laundry not found', 404)
    }

    // Validate query parameters
    const queryParams = Object.fromEntries(searchParams.entries())
    delete queryParams.laundryId // Remove laundryId from validation

    const validatedQuery = validateQuery(ordersQuerySchema, queryParams)
    if (!validatedQuery) {
      return errorResponse('Invalid query parameters', 400)
    }

    const { page = 1, limit = 20, status, service, search, startDate, endDate, sortBy = 'createdAt', sortOrder = 'desc' } = validatedQuery

    // Build where conditions
    const whereConditions: any = {
      laundryId
    }

    // Filter by status
    if (status) {
      whereConditions.status = status
    }

    // Filter by service (product category)
    if (service) {
      whereConditions.orderItems = {
        some: {
          product: {
            category: {
              contains: service,
              mode: 'insensitive'
            }
          }
        }
      }
    }

    // Filter by date range
    if (startDate || endDate) {
      whereConditions.createdAt = {}
      if (startDate) {
        whereConditions.createdAt.gte = new Date(startDate)
      }
      if (endDate) {
        whereConditions.createdAt.lte = new Date(endDate)
      }
    }

    // Search functionality
    if (search) {
      whereConditions.OR = [
        {
          orderNumber: {
            contains: search,
            mode: 'insensitive'
          }
        },
        {
          customer: {
            name: {
              contains: search,
              mode: 'insensitive'
            }
          }
        },
        {
          customer: {
            email: {
              contains: search,
              mode: 'insensitive'
            }
          }
        }
      ]
    }

    // Calculate offset
    const offset = (page - 1) * limit

    // Get total count for pagination
    const totalCount = await prisma.order.count({
      where: whereConditions
    })

    // Get orders with pagination and sorting
    const orderByClause: Record<string, 'asc' | 'desc'> = {}
    orderByClause[sortBy] = sortOrder

    const orders = await prisma.order.findMany({
      where: whereConditions,
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true
          }
        },
        orderItems: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                category: true
              }
            }
          }
        },
        address: {
          select: {
            street: true,
            city: true,
            state: true
          }
        }
      },
      orderBy: orderByClause,
      skip: offset,
      take: limit
    })

    // Format orders for response
    const formattedOrders = orders.map(order => {
      // Get service categories
      const services = Array.from(new Set(order.orderItems.map(item => item.product.category)))
      const primaryService = services[0] || 'General Service'
      
      // Calculate total items
      const totalItems = order.orderItems.reduce((sum, item) => sum + item.quantity, 0)
      
      // Calculate days since order
      const daysSinceOrder = Math.floor(
        (new Date().getTime() - order.createdAt.getTime()) / (1000 * 60 * 60 * 24)
      )
      
      // Check if overdue
      const isOverdue = order.deliveryDate && 
        order.deliveryDate < new Date() && 
        !['DELIVERED', 'COMPLETED', 'CANCELED'].includes(order.status)

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        customer: {
          id: order.customer.id,
          name: order.customer.name || order.customer.email.split('@')[0],
          email: order.customer.email,
          avatar: order.customer.avatar
        },
        status: order.status,
        primaryService,
        services,
        totalItems,
        totalAmount: order.finalAmount,
        deliveryFee: order.deliveryFee,
        deliveryAddress: {
          street: order.address.street,
          city: order.address.city,
          state: order.address.state
        },
        dates: {
          orderDate: order.createdAt,
          pickupDate: order.pickupDate,
          deliveryDate: order.deliveryDate,
          daysSinceOrder
        },
        isOverdue,
        priority: isOverdue ? 'high' : 
                 ['PENDING', 'CONFIRMED'].includes(order.status) ? 'medium' : 'normal'
      }
    })

    // Calculate pagination info
    const totalPages = Math.ceil(totalCount / limit)
    const hasNextPage = page < totalPages
    const hasPrevPage = page > 1

    // Get summary statistics
    const statusCounts = await prisma.order.groupBy({
      by: ['status'],
      where: { laundryId },
      _count: { status: true }
    })

    const statusSummary = statusCounts.reduce((acc, item) => {
      acc[item.status] = item._count.status
      return acc
    }, {} as Record<string, number>)

    const response = {
      orders: formattedOrders,
      pagination: {
        currentPage: page,
        totalPages,
        totalCount,
        limit,
        hasNextPage,
        hasPrevPage,
        showing: formattedOrders.length
      },
      summary: {
        statusCounts: statusSummary,
        totalOrders: totalCount
      },
      filters: {
        status,
        service,
        search,
        dateRange: startDate || endDate ? { startDate, endDate } : null
      }
    }

    return successResponse(response, 'Orders retrieved successfully')
  } catch (error) {
    console.error('Get orders error:', error)
    return errorResponse('Failed to retrieve orders', 500)
  }
}