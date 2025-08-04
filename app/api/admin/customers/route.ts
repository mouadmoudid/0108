// app/api/admin/customers/route.ts
import { prisma } from '@/lib/prisma'
import { successResponse, errorResponse } from '@/lib/response'
import { validateQuery } from '@/lib/validations'
import { NextRequest } from 'next/server'
import { z } from 'zod'

// Query schema for customers
const customersQuerySchema = z.object({
  page: z.coerce.number().min(1).optional().default(1),
  limit: z.coerce.number().min(1).max(100).optional().default(20),
  search: z.string().optional(),
  segment: z.enum(['New', 'Regular', 'Premium', 'VIP']).optional(),
  sortBy: z.enum(['name', 'email', 'totalSpent', 'totalOrders', 'lastOrder', 'createdAt']).optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc')
})

// Customer creation schema
const customerCreateSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Valid email is required'),
  phone: z.string().optional()
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
    delete queryParams.laundryId

    const validatedQuery = validateQuery(customersQuerySchema, queryParams)
    if (!validatedQuery) {
      return errorResponse('Invalid query parameters', 400)
    }

    const { page=1, limit=20, search, segment, sortBy, sortOrder } = validatedQuery

    // Get all customers who have ordered from this laundry with their stats
    const customersWithStats = await prisma.user.findMany({
      where: {
        role: 'CUSTOMER',
        orders: {
          some: {
            laundryId
          }
        },
        ...(search && {
          OR: [
            {
              name: {
                contains: search,
                mode: 'insensitive'
              }
            },
            {
              email: {
                contains: search,
                mode: 'insensitive'
              }
            }
          ]
        })
      },
      include: {
        orders: {
          where: { laundryId },
          select: {
            id: true,
            finalAmount: true,
            createdAt: true,
            status: true
          },
          orderBy: { createdAt: 'desc' }
        },
        reviews: {
          where: { laundryId },
          select: {
            rating: true,
            createdAt: true
          }
        },
        addresses: {
          select: {
            id: true,
            street: true,
            city: true,
            state: true,
            isDefault: true
          },
          take: 1,
          orderBy: { isDefault: 'desc' }
        }
      }
    })

    // Calculate customer segments and additional data
    const customersWithSegments = customersWithStats.map(customer => {
      const totalOrders = customer.orders.length
      const totalSpent = customer.orders.reduce((sum, order) => sum + order.finalAmount, 0)
      const completedOrders = customer.orders.filter(order => 
        ['COMPLETED', 'DELIVERED'].includes(order.status)
      ).length
      
      const lastOrder = customer.orders[0]
      const averageOrderValue = totalOrders > 0 ? totalSpent / totalOrders : 0
      const averageRating = customer.reviews.length > 0 ? 
        customer.reviews.reduce((sum, review) => sum + review.rating, 0) / customer.reviews.length : 0

      // Determine customer segment
      let customerSegment: string
      if (totalSpent >= 500 && totalOrders >= 5) {
        customerSegment = 'VIP'
      } else if (totalSpent >= 200 && totalOrders >= 3) {
        customerSegment = 'Premium'
      } else if (totalOrders >= 2) {
        customerSegment = 'Regular'
      } else {
        customerSegment = 'New'
      }

      // Calculate days since last order
      const daysSinceLastOrder = lastOrder ? 
        Math.floor((new Date().getTime() - lastOrder.createdAt.getTime()) / (1000 * 60 * 60 * 24)) : null

      return {
        id: customer.id,
        name: customer.name || customer.email.split('@')[0],
        email: customer.email,
        phone: customer.phone,
        avatar: customer.avatar,
        memberSince: customer.createdAt,
        segment: customerSegment,
        stats: {
          totalOrders,
          completedOrders,
          totalSpent,
          averageOrderValue,
          averageRating: Math.round(averageRating * 10) / 10
        },
        lastOrder: lastOrder ? {
          id: lastOrder.id,
          amount: lastOrder.finalAmount,
          date: lastOrder.createdAt,
          status: lastOrder.status,
          daysSince: daysSinceLastOrder
        } : null,
        primaryAddress: customer.addresses[0] || null,
        status: daysSinceLastOrder === null ? 'new' :
                daysSinceLastOrder <= 30 ? 'active' :
                daysSinceLastOrder <= 90 ? 'dormant' : 'inactive'
      }
    })

    // Filter by segment if specified
    let filteredCustomers = customersWithSegments
    if (segment) {
      filteredCustomers = customersWithSegments.filter(customer => customer.segment === segment)
    }

    // Sort customers
    filteredCustomers.sort((a, b) => {
      let aValue: any, bValue: any
      
      switch (sortBy) {
        case 'name':
          aValue = a.name.toLowerCase()
          bValue = b.name.toLowerCase()
          break
        case 'email':
          aValue = a.email.toLowerCase()
          bValue = b.email.toLowerCase()
          break
        case 'totalSpent':
          aValue = a.stats.totalSpent
          bValue = b.stats.totalSpent
          break
        case 'totalOrders':
          aValue = a.stats.totalOrders
          bValue = b.stats.totalOrders
          break
        case 'lastOrder':
          aValue = a.lastOrder?.date || new Date(0)
          bValue = b.lastOrder?.date || new Date(0)
          break
        case 'createdAt':
          aValue = a.memberSince
          bValue = b.memberSince
          break
        default:
          aValue = a.memberSince
          bValue = b.memberSince
      }

      if (sortOrder === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0
      }
    })

    // Apply pagination
    const totalCount = filteredCustomers.length
    const offset = (page - 1) * limit
    const paginatedCustomers = filteredCustomers.slice(offset, offset + limit)

    // Calculate pagination info
    const totalPages = Math.ceil(totalCount / limit)
    const hasNextPage = page < totalPages
    const hasPrevPage = page > 1

    // Get segment distribution
    const segmentCounts = customersWithSegments.reduce((acc, customer) => {
      acc[customer.segment] = (acc[customer.segment] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    const response = {
      customers: paginatedCustomers,
      pagination: {
        currentPage: page,
        totalPages,
        totalCount,
        limit,
        hasNextPage,
        hasPrevPage,
        showing: paginatedCustomers.length
      },
      summary: {
        totalCustomers: customersWithSegments.length,
        segmentDistribution: segmentCounts,
        averageOrderValue: customersWithSegments.reduce((sum, c) => sum + c.stats.averageOrderValue, 0) / customersWithSegments.length || 0,
        totalRevenue: customersWithSegments.reduce((sum, c) => sum + c.stats.totalSpent, 0)
      },
      filters: {
        search,
        segment,
        sortBy,
        sortOrder
      }
    }

    return successResponse(response, 'Customers retrieved successfully')
  } catch (error: any) {
    console.error('Get customers error:', error)
    return errorResponse('Failed to retrieve customers', 500)
  }
}

// POST /api/admin/customers
export async function POST(request: NextRequest) {
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

    const body = await request.json()
    const validatedData = validateQuery(customerCreateSchema, body)
    
    if (!validatedData) {
      return errorResponse('Invalid customer data', 400)
    }

    const { firstName, lastName, email, phone } = validatedData

    // Check if customer already exists
    const existingCustomer = await prisma.user.findUnique({
      where: { email }
    })

    if (existingCustomer) {
      return errorResponse('Customer with this email already exists', 400)
    }

    // Create new customer
    const newCustomer = await prisma.user.create({
      data: {
        name: `${firstName} ${lastName}`,
        email,
        phone,
        role: 'CUSTOMER'
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        createdAt: true
      }
    })

    // Verify all required fields before activity creation
    const activityData = {
      type: 'CUSTOMER_ADDED' as const,
      title: 'New customer added',
      description: `Customer ${newCustomer.name} was added to the system`,
      laundryId: laundryId,
      userId: newCustomer.id
    }

    // Only add metadata if all values are defined
    const metadata: any = {}
    if (newCustomer.name) metadata.customerName = newCustomer.name
    if (newCustomer.email) metadata.customerEmail = newCustomer.email
    metadata.addedBy = 'admin'

    try {
      await prisma.activity.create({
        data: {
          ...activityData,
          metadata: Object.keys(metadata).length > 0 ? metadata : undefined
        }
      })
    } catch (activityError) {
      console.error('Activity creation failed:', activityError)
      console.error('Activity data was:', activityData)
      // Continue without failing the main operation
    }

    return successResponse(newCustomer, 'Customer created successfully')
  } catch (error: any) {
    console.error('Create customer error:', error)
    return errorResponse('Failed to create customer', 500)
  }
}