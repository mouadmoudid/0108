import { prisma } from '@/lib/prisma'
import { paginatedResponse, errorResponse } from '@/lib/response'
import { laundryPerformanceQuerySchema, validateQuery } from '@/lib/validations'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const queryParams = Object.fromEntries(searchParams.entries())
    
    const validatedQuery = validateQuery(laundryPerformanceQuerySchema, queryParams)
    if (!validatedQuery) {
      return errorResponse('Invalid query parameters', 400)
    }

    const { page = 1, limit = 10, sortBy = 'revenue', sortOrder } = validatedQuery

    // Calculate offset
    const offset = (page - 1) * limit

    // Get current month start date
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)

    // Build orderBy clause
    let orderBy: any = { createdAt: 'desc' }
    switch (sortBy) {
      case 'ordersMonth':
        orderBy = { totalOrders: sortOrder }
        break
      case 'customers':
        // We'll sort by a calculated field later
        break
      case 'revenue':
        orderBy = { totalRevenue: sortOrder }
        break
      case 'rating':
        orderBy = { rating: sortOrder }
        break
    }

    // Get laundries with performance data
    const laundries = await prisma.laundry.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        logo: true,
        status: true,
        rating: true,
        totalReviews: true,
        totalOrders: true,
        totalRevenue: true,
        createdAt: true,
        addresses: {
          select: {
            city: true,
            state: true
          },
          take: 1
        },
        _count: {
          select: {
            orders: {
              where: {
                createdAt: {
                  gte: startOfMonth
                }
              }
            }
          }
        }
      },
      orderBy,
      skip: offset,
      take: limit,
    })

    // Get unique customers count for each laundry (this month)
    const laundriesWithCustomers = await Promise.all(
      laundries.map(async (laundry) => {
        const uniqueCustomers = await prisma.order.findMany({
          where: {
            laundryId: laundry.id,
            createdAt: {
              gte: startOfMonth
            }
          },
          select: {
            customerId: true
          },
          distinct: ['customerId']
        })

        // Calculate monthly revenue
        const monthlyRevenue = await prisma.order.aggregate({
          where: {
            laundryId: laundry.id,
            status: {
              in: ['COMPLETED', 'DELIVERED']
            },
            createdAt: {
              gte: startOfMonth
            }
          },
          _sum: {
            finalAmount: true
          }
        })

        return {
          id: laundry.id,
          name: laundry.name,
          email: laundry.email,
          phone: laundry.phone,
          logo: laundry.logo,
          status: laundry.status,
          location: laundry.addresses[0] ? `${laundry.addresses[0].city}, ${laundry.addresses[0].state}` : 'Not specified',
          performance: {
            ordersMonth: laundry._count.orders,
            customers: uniqueCustomers.length,
            revenue: monthlyRevenue._sum.finalAmount || 0,
            rating: laundry.rating,
            totalReviews: laundry.totalReviews,
            totalOrders: laundry.totalOrders,
            totalRevenue: laundry.totalRevenue
          },
          joinedAt: laundry.createdAt
        }
      })
    )

    // Sort by customers if requested
    if (sortBy === 'customers') {
      laundriesWithCustomers.sort((a, b) => {
        const comparison = a.performance.customers - b.performance.customers
        return sortOrder === 'asc' ? comparison : -comparison
      })
    }

    // Get total count for pagination
    const totalCount = await prisma.laundry.count()
    const totalPages = Math.ceil(totalCount / limit)

    return paginatedResponse(
      laundriesWithCustomers,
      {
        page,
        limit,
        total: totalCount,
        totalPages
      },
      'Laundries performance retrieved successfully'
    )
  } catch (error) {
    console.error('Laundries performance error:', error)
    return errorResponse('Failed to retrieve laundries performance', 500)
  }
}