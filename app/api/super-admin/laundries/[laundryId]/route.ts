import { prisma } from '@/lib/prisma'
import { successResponse, errorResponse } from '@/lib/response'
import { laundryUpdateSchema, validateQuery } from '@/lib/validations'
import { NextRequest } from 'next/server'

// GET /api/admin/laundries/[laundryId]
export async function GET(
  request: NextRequest,
  { params }: { params: { laundryId: string } }
) {
  try {
    const { laundryId } = params

    // Get current month start date
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)

    const laundry = await prisma.laundry.findUnique({
      where: { id: laundryId },
      include: {
        admin: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            avatar: true
          }
        },
        addresses: true,
        products: {
          where: { isActive: true },
          select: {
            id: true,
            name: true,
            price: true,
            category: true,
            unit: true
          }
        },
        _count: {
          select: {
            orders: true,
            reviews: true,
            products: true
          }
        }
      }
    })

    if (!laundry) {
      return errorResponse('Laundry not found', 404)
    }

    // Get performance metrics
    const [monthlyOrders, monthlyRevenue, uniqueCustomers, recentOrders] = await Promise.all([
      // Monthly orders count
      prisma.order.count({
        where: {
          laundryId,
          createdAt: { gte: startOfMonth }
        }
      }),

      // Monthly revenue
      prisma.order.aggregate({
        where: {
          laundryId,
          status: { in: ['COMPLETED', 'DELIVERED'] },
          createdAt: { gte: startOfMonth }
        },
        _sum: { finalAmount: true }
      }),

      // Unique customers this month
      prisma.order.findMany({
        where: {
          laundryId,
          createdAt: { gte: startOfMonth }
        },
        select: { customerId: true },
        distinct: ['customerId']
      }),

      // Recent orders (last 5)
      prisma.order.findMany({
        where: { laundryId },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          finalAmount: true,
          createdAt: true,
          customer: {
            select: {
              name: true,
              email: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 5
      })
    ])

    // Calculate average order value
    const avgOrderValue = laundry.totalOrders > 0 
      ? laundry.totalRevenue / laundry.totalOrders 
      : 0

    const response = {
      id: laundry.id,
      name: laundry.name,
      email: laundry.email,
      phone: laundry.phone,
      description: laundry.description,
      logo: laundry.logo,
      status: laundry.status,
      operatingHours: laundry.operatingHours,
      admin: laundry.admin,
      addresses: laundry.addresses,
      services: laundry.products,
      performance: {
        rating: laundry.rating,
        totalReviews: laundry.totalReviews,
        totalOrders: laundry.totalOrders,
        totalRevenue: laundry.totalRevenue,
        monthlyOrders,
        monthlyRevenue: monthlyRevenue._sum.finalAmount || 0,
        uniqueCustomers: uniqueCustomers.length,
        averageOrderValue: avgOrderValue
      },
      counts: {
        orders: laundry._count.orders,
        reviews: laundry._count.reviews,
        services: laundry._count.products
      },
      recentActivity: recentOrders.map(order => ({
        id: order.id,
        type: 'ORDER_CREATED',
        title: `New order ${order.orderNumber}`,
        description: `Order from ${order.customer.name || order.customer.email}`,
        amount: order.finalAmount,
        status: order.status,
        createdAt: order.createdAt
      })),
      createdAt: laundry.createdAt,
      updatedAt: laundry.updatedAt
    }

    return successResponse(response, 'Laundry details retrieved successfully')
  } catch (error) {
    console.error('Get laundry error:', error)
    return errorResponse('Failed to retrieve laundry details', 500)
  }
}

// PATCH /api/admin/laundries/[laundryId]
export async function PATCH(
  request: NextRequest,
  { params }: { params: { laundryId: string } }
) {
  try {
    const { laundryId } = params
    const body = await request.json()

    const validatedData = validateQuery(laundryUpdateSchema, body)
    if (!validatedData) {
      return errorResponse('Invalid input data', 400)
    }

    // Check if laundry exists
    const existingLaundry = await prisma.laundry.findUnique({
      where: { id: laundryId }
    })

    if (!existingLaundry) {
      return errorResponse('Laundry not found', 404)
    }

    // Check if email is unique (if being updated)
    if (validatedData.email && validatedData.email !== existingLaundry.email) {
      const emailExists = await prisma.laundry.findUnique({
        where: { email: validatedData.email }
      })
      if (emailExists) {
        return errorResponse('Email already exists', 409)
      }
    }

    // Update laundry
    const updatedLaundry = await prisma.laundry.update({
      where: { id: laundryId },
      data: {
        ...validatedData,
        updatedAt: new Date()
      },
      include: {
        admin: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    })

    // Create activity
    await prisma.activity.create({
      data: {
        type: 'LAUNDRY_UPDATED',
        title: 'Laundry information updated',
        description: `Laundry ${updatedLaundry.name} information has been updated`,
        laundryId: laundryId,
        metadata: {
          updatedFields: Object.keys(validatedData),
          updatedBy: 'Super Admin'
        }
      }
    })

    return successResponse(updatedLaundry, 'Laundry updated successfully')
  } catch (error) {
    console.error('Update laundry error:', error)
    return errorResponse('Failed to update laundry', 500)
  }
}