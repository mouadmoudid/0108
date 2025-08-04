// // app/api/admin/analytics/overview/route.ts
// import { prisma } from '@/lib/prisma'
// import { successResponse, errorResponse } from '@/lib/response'
// import { NextRequest } from 'next/server'

// export async function GET(request: NextRequest) {
//   try {
//     const { searchParams } = new URL(request.url)
//     const laundryId = searchParams.get('laundryId')
//     const startDateStr = searchParams.get('startDate')
//     const endDateStr = searchParams.get('endDate')

//     if (!laundryId) {
//       return errorResponse('laundryId parameter is required', 400)
//     }

//     if (!startDateStr || !endDateStr) {
//       return errorResponse('startDate and endDate parameters are required', 400)
//     }

//     const startDate = new Date(startDateStr)
//     const endDate = new Date(endDateStr)

//     if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
//       return errorResponse('Invalid date format', 400)
//     }

//     // Verify laundry exists
//     const laundry = await prisma.laundry.findUnique({
//       where: { id: laundryId }
//     })

//     if (!laundry) {
//       return errorResponse('Laundry not found', 404)
//     }

//     // Get orders within the date range
//     const orders = await prisma.order.findMany({
//       where: {
//         laundryId,
//         createdAt: {
//           gte: startDate,
//           lte: endDate
//         }
//       },
//       include: {
//         customer: {
//           select: {
//             id: true,
//             name: true,
//             email: true
//           }
//         },
//         orderItems: {
//           include: {
//             product: {
//               select: {
//                 category: true,
//                 name: true
//               }
//             }
//           }
//         }
//       }
//     })

//     // Calculate basic metrics
//     const totalOrders = orders.length
//     const totalRevenue = orders.reduce((sum, order) => sum + order.finalAmount, 0)
//     const completedOrders = orders.filter(order => 
//       ['COMPLETED', 'DELIVERED'].includes(order.status)
//     )
//     const completedRevenue = completedOrders.reduce((sum, order) => sum + order.finalAmount, 0)
//     const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0

//     // Customer metrics
//     const uniqueCustomers = new Set(orders.map(order => order.customerId)).size
//     const newCustomers = await prisma.user.count({
//       where: {
//         role: 'CUSTOMER',
//         createdAt: {
//           gte: startDate,
//           lte: endDate
//         },
//         orders: {
//           some: { laundryId }
//         }
//       }
//     })

//     // Calculate repeat customers
//     const customerOrderCounts = orders.reduce((acc, order) => {
//       acc[order.customerId] = (acc[order.customerId] || 0) + 1
//       return acc
//     }, {} as Record<string, number>)
    
//     const repeatCustomers = Object.values(customerOrderCounts).filter(count => count > 1).length
//     const customerRetentionRate = uniqueCustomers > 0 ? (repeatCustomers / uniqueCustomers) * 100 : 0

//     // Order status distribution
//     const statusDistribution = orders.reduce((acc, order) => {
//       acc[order.status] = (acc[order.status] || 0) + 1
//       return acc
//     }, {} as Record<string, number>)

//     // Service category performance
//     const categoryPerformance: Record<string, { orders: Set<string>; revenue: number; quantity: number }> = {}
//     orders.forEach(order => {
//       order.orderItems.forEach(item => {
//         const category = item.product.category || 'Other'
//         if (!categoryPerformance[category]) {
//           categoryPerformance[category] = {
//             orders: new Set(),
//             revenue: 0,
//             quantity: 0
//           }
//         }
//         categoryPerformance[category].orders.add(order.id)
//         categoryPerformance[category].revenue += item.totalPrice
//         categoryPerformance[category].quantity += item.quantity
//       })
//     })

//     const categoryStats = Object.entries(categoryPerformance).map(([category, data]) => ({
//       category,
//       orders: data.orders.size,
//       revenue: data.revenue,
//       quantity: data.quantity,
//       percentage: totalRevenue > 0 ? (data.revenue / totalRevenue) * 100 : 0
//     })).sort((a, b) => b.revenue - a.revenue)

//     // Daily performance breakdown
//     const dailyPerformance = []
//     const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
    
//     for (let i = 0; i <= daysDiff; i++) {
//       const currentDate = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000)
//       const dayStart = new Date(currentDate.setHours(0, 0, 0, 0))
//       const dayEnd = new Date(currentDate.setHours(23, 59, 59, 999))
      
//       const dayOrders = orders.filter(order => 
//         order.createdAt >= dayStart && order.createdAt <= dayEnd
//       )
      
//       const dayRevenue = dayOrders.reduce((sum, order) => sum + order.finalAmount, 0)
//       const dayCustomers = new Set(dayOrders.map(order => order.customerId)).size
      
//       dailyPerformance.push({
//         date: dayStart.toISOString().split('T')[0],
//         orders: dayOrders.length,
//         revenue: dayRevenue,
//         customers: dayCustomers,
//         averageOrderValue: dayOrders.length > 0 ? dayRevenue / dayOrders.length : 0
//       })
//     }

//     // Top customers in the period
//     const customerSpending: Record<string, { customer: any; orders: number; totalSpent: number }> = {}
//     orders.forEach(order => {
//       const customerId = order.customerId
//       if (!customerSpending[customerId]) {
//         customerSpending[customerId] = {
//           customer: order.customer,
//           orders: 0,
//           totalSpent: 0
//         }
//       }
//       customerSpending[customerId].orders++
//       customerSpending[customerId].totalSpent += order.finalAmount
//     })

//     const topCustomers = Object.values(customerSpending)
//       .sort((a, b) => b.totalSpent - a.totalSpent)
//       .slice(0, 10)
//       .map((customer) => ({
//         id: customer.customer.id,
//         name: customer.customer.name || customer.customer.email.split('@')[0],
//         email: customer.customer.email,
//         orders: customer.orders,
//         totalSpent: customer.totalSpent,
//         averageOrderValue: customer.totalSpent / customer.orders
//       }))

//     // Peak hours analysis
//     const hourlyDistribution: Record<number, number> = {}
//     orders.forEach(order => {
//       const hour = order.createdAt.getHours()
//       hourlyDistribution[hour] = (hourlyDistribution[hour] || 0) + 1
//     })

//     const peakHours = Object.entries(hourlyDistribution)
//       .map(([hour, count]) => ({ hour: parseInt(hour), orders: count }))
//       .sort((a, b) => b.orders - a.orders)
//       .slice(0, 5)

//     // Compare with previous period (same duration before start date)
//     const previousPeriodStart = new Date(startDate.getTime() - (endDate.getTime() - startDate.getTime()))
//     const previousOrders = await prisma.order.findMany({
//       where: {
//         laundryId,
//         createdAt: {
//           gte: previousPeriodStart,
//           lt: startDate
//         }
//       }
//     })

//     const previousRevenue = previousOrders.reduce((sum, order) => sum + order.finalAmount, 0)
//     const revenueGrowth = previousRevenue > 0 ? ((totalRevenue - previousRevenue) / previousRevenue) * 100 : 0
//     const orderGrowth = previousOrders.length > 0 ? ((totalOrders - previousOrders.length) / previousOrders.length) * 100 : 0

//     const response = {
//       // Period information
//       period: {
//         startDate: startDate.toISOString(),
//         endDate: endDate.toISOString(),
//         days: daysDiff + 1
//       },

//       // Key performance metrics
//       metrics: {
//         totalOrders,
//         totalRevenue,
//         completedOrders: completedOrders.length,
//         completedRevenue,
//         averageOrderValue,
//         uniqueCustomers,
//         newCustomers,
//         repeatCustomers,
//         customerRetentionRate
//       },

//       // Growth comparisons
//       growth: {
//         revenueGrowth,
//         orderGrowth,
//         previousPeriodRevenue: previousRevenue,
//         previousPeriodOrders: previousOrders.length
//       },

//       // Detailed breakdowns
//       breakdowns: {
//         orderStatus: statusDistribution,
//         serviceCategories: categoryStats,
//         dailyPerformance,
//         hourlyDistribution: Object.entries(hourlyDistribution).map(([hour, count]) => ({
//           hour: parseInt(hour),
//           orders: count
//         })).sort((a, b) => a.hour - b.hour)
//       },

//       // Top performers
//       topPerformers: {
//         customers: topCustomers,
//         peakHours,
//         topCategory: categoryStats[0]?.category || 'No categories'
//       },

//       // Business insights
//       insights: {
//         busiest_day: dailyPerformance.reduce((max, day) => 
//           day.orders > max.orders ? day : max, dailyPerformance[0] || { date: null, orders: 0 }
//         ),
//         highest_revenue_day: dailyPerformance.reduce((max, day) => 
//           day.revenue > max.revenue ? day : max, dailyPerformance[0] || { date: null, revenue: 0 }
//         ),
//         conversion_rate: totalOrders > 0 ? (completedOrders.length / totalOrders) * 100 : 0,
//         average_daily_orders: dailyPerformance.length > 0 ? 
//           dailyPerformance.reduce((sum, day) => sum + day.orders, 0) / dailyPerformance.length : 0
//       }
//     }

//     return successResponse(response, 'Analytics overview retrieved successfully')
//   } catch (error: any) {
//     console.error('Analytics overview error:', error)
//     return errorResponse('Failed to retrieve analytics overview', 500)
//   }
// }

// app/api/admin/analytics/overview/route.ts
import { prisma } from '@/lib/prisma'
import { successResponse, errorResponse } from '@/lib/response'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const laundryId = searchParams.get('laundryId')
    const startDateStr = searchParams.get('startDate')
    const endDateStr = searchParams.get('endDate')

    if (!laundryId) {
      return errorResponse('laundryId parameter is required', 400)
    }

    if (!startDateStr || !endDateStr) {
      return errorResponse('startDate and endDate parameters are required', 400)
    }

    const startDate = new Date(startDateStr)
    const endDate = new Date(endDateStr)

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return errorResponse('Invalid date format', 400)
    }

    // Verify laundry exists
    const laundry = await prisma.laundry.findUnique({
      where: { id: laundryId }
    })

    if (!laundry) {
      return errorResponse('Laundry not found', 404)
    }

    // Get orders within the date range
    const orders = await prisma.order.findMany({
      where: {
        laundryId,
        createdAt: {
          gte: startDate,
          lte: endDate
        }
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        orderItems: {
          include: {
            product: {
              select: {
                category: true,
                name: true
              }
            }
          }
        }
      }
    })

    // Calculate basic metrics
    const totalOrders = orders.length
    const totalRevenue = orders.reduce((sum, order) => sum + order.finalAmount, 0)
    const completedOrders = orders.filter(order => 
      ['COMPLETED', 'DELIVERED'].includes(order.status)
    )
    const completedRevenue = completedOrders.reduce((sum, order) => sum + order.finalAmount, 0)
    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0

    // Customer metrics
    const uniqueCustomers = new Set(orders.map(order => order.customerId)).size
    const newCustomers = await prisma.user.count({
      where: {
        role: 'CUSTOMER',
        createdAt: {
          gte: startDate,
          lte: endDate
        },
        orders: {
          some: { laundryId }
        }
      }
    })

    // Calculate repeat customers
    const customerOrderCounts = orders.reduce((acc, order) => {
      acc[order.customerId] = (acc[order.customerId] || 0) + 1
      return acc
    }, {} as Record<string, number>)
    
    const repeatCustomers = Object.values(customerOrderCounts).filter(count => count > 1).length
    const customerRetentionRate = uniqueCustomers > 0 ? (repeatCustomers / uniqueCustomers) * 100 : 0

    // Order status distribution
    const statusDistribution = orders.reduce((acc, order) => {
      acc[order.status] = (acc[order.status] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    // Service category performance
    const categoryPerformance: Record<string, { orders: Set<string>; revenue: number; quantity: number }> = {}
    orders.forEach(order => {
      order.orderItems.forEach(item => {
        const category = item.product.category || 'Other'
        if (!categoryPerformance[category]) {
          categoryPerformance[category] = {
            orders: new Set(),
            revenue: 0,
            quantity: 0
          }
        }
        categoryPerformance[category].orders.add(order.id)
        categoryPerformance[category].revenue += item.totalPrice
        categoryPerformance[category].quantity += item.quantity
      })
    })

    const categoryStats = Object.entries(categoryPerformance).map(([category, data]) => ({
      category,
      orders: data.orders.size,
      revenue: data.revenue,
      quantity: data.quantity,
      percentage: totalRevenue > 0 ? (data.revenue / totalRevenue) * 100 : 0
    })).sort((a, b) => b.revenue - a.revenue)

    // Daily performance breakdown
    const dailyPerformance = []
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
    
    for (let i = 0; i <= daysDiff; i++) {
      const currentDate = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000)
      const dayStart = new Date(currentDate.setHours(0, 0, 0, 0))
      const dayEnd = new Date(currentDate.setHours(23, 59, 59, 999))
      
      const dayOrders = orders.filter(order => 
        order.createdAt >= dayStart && order.createdAt <= dayEnd
      )
      
      const dayRevenue = dayOrders.reduce((sum, order) => sum + order.finalAmount, 0)
      const dayCustomers = new Set(dayOrders.map(order => order.customerId)).size
      
      dailyPerformance.push({
        date: dayStart.toISOString().split('T')[0],
        orders: dayOrders.length,
        revenue: dayRevenue,
        customers: dayCustomers,
        averageOrderValue: dayOrders.length > 0 ? dayRevenue / dayOrders.length : 0
      })
    }

    // Top customers in the period
    const customerSpending: Record<string, { customer: any; orders: number; totalSpent: number }> = {}
    orders.forEach(order => {
      const customerId = order.customerId
      if (!customerSpending[customerId]) {
        customerSpending[customerId] = {
          customer: order.customer,
          orders: 0,
          totalSpent: 0
        }
      }
      customerSpending[customerId].orders++
      customerSpending[customerId].totalSpent += order.finalAmount
    })

    const topCustomers = Object.values(customerSpending)
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, 10)
      .map((customer) => ({
        id: customer.customer.id,
        name: customer.customer.name || customer.customer.email.split('@')[0],
        email: customer.customer.email,
        orders: customer.orders,
        totalSpent: customer.totalSpent,
        averageOrderValue: customer.totalSpent / customer.orders
      }))

    // Peak hours analysis
    const hourlyDistribution: Record<number, number> = {}
    orders.forEach(order => {
      const hour = order.createdAt.getHours()
      hourlyDistribution[hour] = (hourlyDistribution[hour] || 0) + 1
    })

    const peakHours = Object.entries(hourlyDistribution)
      .map(([hour, count]) => ({ hour: parseInt(hour), orders: count }))
      .sort((a, b) => b.orders - a.orders)
      .slice(0, 5)

    // Compare with previous period (same duration before start date)
    const previousPeriodStart = new Date(startDate.getTime() - (endDate.getTime() - startDate.getTime()))
    const previousOrders = await prisma.order.findMany({
      where: {
        laundryId,
        createdAt: {
          gte: previousPeriodStart,
          lt: startDate
        }
      }
    })

    const previousRevenue = previousOrders.reduce((sum, order) => sum + order.finalAmount, 0)
    const revenueGrowth = previousRevenue > 0 ? ((totalRevenue - previousRevenue) / previousRevenue) * 100 : 0
    const orderGrowth = previousOrders.length > 0 ? ((totalOrders - previousOrders.length) / previousOrders.length) * 100 : 0

    const response = {
      // Period information
      period: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        days: daysDiff + 1
      },

      // Key performance metrics
      metrics: {
        totalOrders,
        totalRevenue,
        completedOrders: completedOrders.length,
        completedRevenue,
        averageOrderValue,
        uniqueCustomers,
        newCustomers,
        repeatCustomers,
        customerRetentionRate
      },

      // Growth comparisons
      growth: {
        revenueGrowth,
        orderGrowth,
        previousPeriodRevenue: previousRevenue,
        previousPeriodOrders: previousOrders.length
      },

      // Detailed breakdowns
      breakdowns: {
        orderStatus: statusDistribution,
        serviceCategories: categoryStats,
        dailyPerformance,
        hourlyDistribution: Object.entries(hourlyDistribution).map(([hour, count]) => ({
          hour: parseInt(hour),
          orders: count
        })).sort((a, b) => a.hour - b.hour)
      },

      // Top performers
      topPerformers: {
        customers: topCustomers,
        peakHours,
        topCategory: categoryStats[0]?.category || 'No categories'
      },

      // Business insights
      insights: {
        busiest_day: dailyPerformance.reduce((max, day) => 
          day.orders > max.orders ? day : max, dailyPerformance[0] || { date: null, orders: 0 }
        ),
        highest_revenue_day: dailyPerformance.reduce((max, day) => 
          day.revenue > max.revenue ? day : max, dailyPerformance[0] || { date: null, revenue: 0 }
        ),
        conversion_rate: totalOrders > 0 ? (completedOrders.length / totalOrders) * 100 : 0,
        average_daily_orders: dailyPerformance.length > 0 ? 
          dailyPerformance.reduce((sum, day) => sum + day.orders, 0) / dailyPerformance.length : 0
      }
    }

    return successResponse(response, 'Analytics overview retrieved successfully')
  } catch (error: any) {
    console.error('Analytics overview error:', error)
    return errorResponse('Failed to retrieve analytics overview', 500)
  }
}