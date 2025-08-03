// app/api/user/orders/route.ts
import { prisma } from '@/lib/prisma'
import { successResponse, errorResponse } from '@/lib/response'
import { validateQuery } from '@/lib/validations'
import { NextRequest } from 'next/server'
import { z } from 'zod'

// Order creation schema
const orderCreateSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  laundryId: z.string().min(1, 'Laundry ID is required'),
  addressId: z.string().min(1, 'Address ID is required'),
  items: z.array(z.object({
    productId: z.string().min(1, 'Product ID is required'),
    quantity: z.number().min(1, 'Quantity must be at least 1')
  })).min(1, 'At least one item is required'),
  pickupDate: z.string().datetime().optional(),
  deliveryDate: z.string().datetime().optional(),
  notes: z.string().optional(),
})

// POST /api/user/orders
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const validatedData = validateQuery(orderCreateSchema, body)
    
    if (!validatedData) {
      return errorResponse('Invalid order data', 400)
    }

    const { userId, laundryId, addressId, items, pickupDate, deliveryDate, notes } = validatedData

    // Verify user exists and is a customer
    const user = await prisma.user.findUnique({
      where: { 
        id: userId,
        role: 'CUSTOMER' 
      }
    })

    if (!user) {
      return errorResponse('Customer not found', 404)
    }

    // Verify laundry exists and is active
    const laundry = await prisma.laundry.findUnique({
      where: { 
        id: laundryId,
        status: 'ACTIVE' 
      }
    })

    if (!laundry) {
      return errorResponse('Laundry not found or inactive', 404)
    }

    // Verify address belongs to user
    const address = await prisma.address.findFirst({
      where: { 
        id: addressId,
        userId 
      }
    })

    if (!address) {
      return errorResponse('Address not found or does not belong to customer', 404)
    }

    // Get product details and calculate prices
    const products = await prisma.product.findMany({
      where: { 
        id: { in: items.map(item => item.productId) },
        laundryId 
      }
    })

    if (products.length !== items.length) {
      return errorResponse('Some products not found or not from the selected laundry', 400)
    }

    // Calculate order totals
    let totalAmount = 0
    const orderItems = items.map(item => {
      const product = products.find(p => p.id === item.productId)!
      const totalPrice = product.price * item.quantity
      totalAmount += totalPrice
      
      return {
        productId: item.productId,
        quantity: item.quantity,
        price: product.price,
        totalPrice
      }
    })

    const deliveryFee = 15.00 // Fixed delivery fee
    const discount = 0 // TODO: Apply any applicable discounts
    const finalAmount = totalAmount + deliveryFee - discount

    // Generate order number
    const orderNumber = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`

    // Create order with items in a transaction
    const order = await prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          orderNumber,
          customerId: userId,
          laundryId,
          addressId,
          totalAmount,
          deliveryFee,
          discount,
          finalAmount,
          status: 'PENDING',
          pickupDate: pickupDate ? new Date(pickupDate) : null,
          deliveryDate: deliveryDate ? new Date(deliveryDate) : null,
          notes
        }
      })

      // Create order items
      await tx.orderItem.createMany({
        data: orderItems.map(item => ({
          ...item,
          orderId: newOrder.id
        }))
      })

      // Create activity log
      await tx.activity.create({
        data: {
          type: 'ORDER_CREATED',
          title: 'Order Created',
          description: `New order ${orderNumber} created by customer`,
          orderId: newOrder.id,
          laundryId,
          userId
        }
      })

      return newOrder
    })

    // Return order with details
    const orderWithDetails = await prisma.order.findUnique({
      where: { id: order.id },
      include: {
        orderItems: {
          include: {
            product: {
              select: {
                name: true,
                category: true,
                unit: true
              }
            }
          }
        },
        laundry: {
          select: {
            name: true,
            logo: true,
            phone: true
          }
        },
        address: true
      }
    })

    return successResponse(orderWithDetails, 'Order created successfully')
  } catch (error) {
    console.error('Create order error:', error)
    return errorResponse('Failed to create order', 500)
  }
}