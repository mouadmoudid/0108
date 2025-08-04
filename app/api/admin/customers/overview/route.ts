// app/api/admin/customers/overview/route.ts
import { prisma } from '@/lib/prisma'
import { successResponse, errorResponse } from '@/lib/response'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const timeframe = searchParams.get('timeframe') || 'month'
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

    // Calculate date range based on timeframe
    const now = new Date()
    let startDate: Date
    
    switch (timeframe) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        break
      case 'month':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        break
      case 'year':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
        break
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    }

    // Get all customers who have ordered from this laundry
    const customersWithOrders = await prisma.order.findMany({
      where: { laundryId },
      select: {
        customerId: true,
        createdAt: true,
        finalAmount: true,
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            createdAt: true
          }
        }
      },
      distinct: ['customerId']
    })

    // Get total unique customers
    const totalCustomers = customersWithOrders.length

    // Get active customers (ordered in the timeframe)
    const activeCustomers = await prisma.order.findMany({
      where: {
        laundryId,
        createdAt: {
          gte: startDate
        }
      },
      select: { customerId: true },
      distinct: ['customerId']
    })

    const activeCustomersCount = activeCustomers.length

    // Get new customers in the timeframe
    const newCustomers = customersWithOrders.filter(order => 
      order.createdAt >= startDate
    ).length

    // Calculate Customer Lifetime Value (LTV)
    const customerOrders = await prisma.order.groupBy({
      by: ['customerId'],
      where: { laundryId },
      _sum: { finalAmount: true },
      _count: { id: true }
    })

    const totalRevenue = customerOrders.reduce((sum, customer) => 
      sum + (customer._sum.finalAmount || 0), 0
    )
    
    const averageLTV = totalCustomers > 0 ? totalRevenue / totalCustomers : 0

    // Generate customer growth chart data
    const growthChartData = []
    const periodsToShow = timeframe === 'year' ? 12 : timeframe === 'month' ? 4 : 7
    const periodLength = timeframe === 'year' ? 30 : timeframe === 'month' ? 7 : 1
    
    for (let i = periodsToShow - 1; i >= 0; i--) {
      const periodStart = new Date(now.getTime() - (i + 1) * periodLength * 24 * 60 * 60 * 1000)
      const periodEnd = new Date(now.getTime() - i * periodLength * 24 * 60 * 60 * 1000)
      
      // New customers in this period
      const periodNewCustomers = customersWithOrders.filter(order => 
        order.createdAt >= periodStart && order.createdAt <= periodEnd
      ).length

      // Active customers in this period
      const periodActiveCustomers = await prisma.order.findMany({
        where: {
          laundryId,
          createdAt: {
            gte: periodStart,
            lte: periodEnd
          }
        },
        select: { customerId: true },
        distinct: ['customerId']
      })

      let periodLabel: string
      if (timeframe === 'year') {
        periodLabel = periodStart.toLocaleDateString('en-US', { month: 'short' })
      } else if (timeframe === 'month') {
        periodLabel = `Week ${periodsToShow - i}`
      } else {
        periodLabel = periodStart.toLocaleDateString('en-US', { weekday: 'short' })
      }
      
      growthChartData.push({
        period: periodLabel,
        newCustomers: periodNewCustomers,
        activeCustomers: periodActiveCustomers.length,
        totalCustomers: customersWithOrders.filter(order => 
          order.createdAt <= periodEnd
        ).length
      })
    }

    // Customer segments based on spending and frequency
    interface CustomerSegment {
        segment: string;
        count: number;
        revenue: number;
        averageSpending: number;
        percentage?: number;
    }

    const customerSegments: CustomerSegment[] = [];
    
    for (const customerData of customerOrders) {
      const totalSpent = customerData._sum.finalAmount || 0
      const orderCount = customerData._count.id
      
      let segment: string
      if (totalSpent >= 500 && orderCount >= 5) {
        segment = 'VIP'
      } else if (totalSpent >= 200 && orderCount >= 3) {
        segment = 'Premium'
      } else if (orderCount >= 2) {
        segment = 'Regular'
      } else {
        segment = 'New'
      }
      
      const existingSegment = customerSegments.find(s => s.segment === segment)
      if (existingSegment) {
        existingSegment.count++
        existingSegment.revenue += totalSpent
      } else {
        customerSegments.push({
          segment,
          count: 1,
          revenue: totalSpent,
          averageSpending: totalSpent
        })
      }
    }

    // Calculate average spending per segment
    customerSegments.forEach(segment => {
      segment.averageSpending = segment.count > 0 ? segment.revenue / segment.count : 0
      segment.percentage = totalCustomers > 0 ? (segment.count / totalCustomers) * 100 : 0
    })

    // Customer retention rate (customers who made repeat orders)
    const repeatCustomers = customerOrders.filter(customer => customer._count.id > 1).length
    const retentionRate = totalCustomers > 0 ? (repeatCustomers / totalCustomers) * 100 : 0

    const response = {
      // Key metrics
      metrics: {
        totalCustomers,
        activeCustomers: activeCustomersCount,
        newCustomersThisPeriod: newCustomers,
        averageLTV,
        retentionRate
      },
      
      // Growth analysis
      growth: {
        periodGrowth: newCustomers,
        growthRate: totalCustomers > 0 ? (newCustomers / totalCustomers) * 100 : 0,
        chartData: growthChartData
      },
      
      // Customer segmentation
      segments: customerSegments.sort((a, b) => b.averageSpending - a.averageSpending),
      
      // Additional insights
      insights: {
        averageOrdersPerCustomer: totalCustomers > 0 ? 
          customerOrders.reduce((sum, c) => sum + c._count.id, 0) / totalCustomers : 0,
        topSpendingSegment: customerSegments.reduce((top, current) => 
          current.averageSpending > (top?.averageSpending ?? 0) ? current : (top ?? current)
        ),
        customerAcquisitionTrend: growthChartData.slice(-3).map(d => d.newCustomers)
      },
      
      // Period info
      period: {
        timeframe,
        startDate: startDate.toISOString(),
        endDate: now.toISOString()
      }
    }

    return successResponse(response, 'Customer overview retrieved successfully')
  } catch (error) {
    console.error('Customer overview error:', error)
    return errorResponse('Failed to retrieve customer overview', 500)
  }
}