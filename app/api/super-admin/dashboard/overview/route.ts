import { prisma } from '@/lib/prisma'
import { successResponse, errorResponse } from '@/lib/response'

export async function GET() {
  try {
    // Get current date and start of month for calculations
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

    // Parallel queries for better performance
    const [
      totalLaundries,
      totalUsers,
      totalOrders,
      monthlyOrders,
      totalRevenue,
      monthlyRevenue,
      activeLaundries,
      pendingOrders,
      completedOrders
    ] = await Promise.all([
      // Total laundries
      prisma.laundry.count(),
      
      // Total users (customers)
      prisma.user.count({
        where: { role: 'CUSTOMER' }
      }),
      
      // Total orders
      prisma.order.count(),
      
      // Monthly orders
      prisma.order.count({
        where: {
          createdAt: {
            gte: startOfMonth
          }
        }
      }),
      
      // Total revenue
      prisma.order.aggregate({
        _sum: {
          finalAmount: true
        },
        where: {
          status: {
            in: ['COMPLETED', 'DELIVERED']
          }
        }
      }),
      
      // Monthly revenue
      prisma.order.aggregate({
        _sum: {
          finalAmount: true
        },
        where: {
          status: {
            in: ['COMPLETED', 'DELIVERED']
          },
          createdAt: {
            gte: startOfMonth
          }
        }
      }),
      
      // Active laundries
      prisma.laundry.count({
        where: { status: 'ACTIVE' }
      }),
      
      // Pending orders
      prisma.order.count({
        where: {
          status: {
            in: ['PENDING', 'CONFIRMED', 'IN_PROGRESS']
          }
        }
      }),
      
      // Completed orders this month
      prisma.order.count({
        where: {
          status: 'COMPLETED',
          createdAt: {
            gte: startOfMonth
          }
        }
      })
    ])

    // Calculate growth percentages (simplified - you might want to compare with previous month)
    const data = {
      overview: {
        totalLaundries,
        totalUsers,
        totalOrders,
        platformRevenue: totalRevenue._sum.finalAmount || 0,
      },
      monthlyStats: {
        monthlyOrders,
        monthlyRevenue: monthlyRevenue._sum.finalAmount || 0,
        completedOrders,
      },
      status: {
        activeLaundries,
        suspendedLaundries: totalLaundries - activeLaundries,
        pendingOrders,
      },
      growth: {
        ordersGrowth: 15.3, // This should be calculated based on previous period
        revenueGrowth: 23.1, // This should be calculated based on previous period
        userGrowth: 8.7, // This should be calculated based on previous period
      }
    }

    return successResponse(data, 'Dashboard overview retrieved successfully')
  } catch (error) {
    console.error('Dashboard overview error:', error)
    return errorResponse('Failed to retrieve dashboard overview', 500)
  }
}