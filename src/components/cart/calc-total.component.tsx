import React from "react";
import {
  Box,
  Button,
  Modal,
  Paper,
  Typography,
  TextField,
} from "@mui/material";
import Keyboard from "react-simple-keyboard";
import "react-simple-keyboard/build/css/index.css";
import ShoppingBasketIcon from "@mui/icons-material/ShoppingBasket";
import { calcTotal, ccyFormat, groupProducts, isCartEmpty } from "./cart.motor";
import { appContext } from "../../appContext";
import { generateNewOrderId, getLastOrderId } from "../orders/order.motor";
import { useNavigate, useLocation } from "react-router-dom";
import classes from "./css/calc-total.module.css";
import { useTranslation } from "react-i18next";
import { useEffect, useRef } from "react";
import { RotatingLines } from "react-loader-spinner";
import { Checkmark } from "react-checkmark";
import paymentGif from "../../../public/imgs/gifs/payment.gif";
import CancelIcon from "@mui/icons-material/Cancel";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { sendEmail } from "./sendEmail";
import { Hourglass } from "react-loader-spinner";

export const CalcTotal: React.FC = () => {
  const { productsInCart, setProductsInCart } =
    React.useContext(appContext).cartCTX;
  const { orders, setOrders } = React.useContext(appContext).orderCTX;
  const productsGrouped = groupProducts(productsInCart);
  const total = calcTotal(productsGrouped);

  const [openOrderModal, setOpenOrderModal] = React.useState(false);
  const [openEmailModal, setOpenEmailModal] = React.useState(false);
  const [openReadyToPourModal, setOpenReadyToPourModal] = React.useState(false);
  const [openLoadingModal, setOpenLoadingModal] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [emailError, setEmailError] = React.useState(false);
  const [keyboardInput, setKeyboardInput] = React.useState("");
  const inactivityTimeout = useRef<NodeJS.Timeout | null>(null);
  const decisionTimeout = useRef<NodeJS.Timeout | null>(null);
  const [openInactivityModal, setOpenInactivityModal] = React.useState(false);
  const [recievedPayment, setRecievedPayment] = React.useState(null);
  const navigate = useNavigate();
  const location = useLocation();

  const handleOrderModalOpen = () => setOpenOrderModal(true);
  const handleOrderModalClose = () => setOpenOrderModal(false);

  const { t } = useTranslation("common");

  const handleEmailModalClose = () => {
    setOpenEmailModal(false);
    setEmail("");
    setProductsInCart([]);
    handleReadyToPourModal();
  };

  const handleReadyToPourModal = () => {
    setOpenReadyToPourModal(false);
    const checkReadyStatus = async () => {
      try {
        const response = await fetch("http://127.0.0.1:8004/ready_status");
        const data = await response.json();

        if (data.status === "done") {
          setOpenReadyToPourModal(false);
        }
        if (data.status === "Empty") {
          alert("The Tank is empty, please refill it");
        } else {
          setTimeout(checkReadyStatus, 5000);
        }
      } catch (error) {
        console.error("Failed to fetch ready status:", error);
        setTimeout(checkReadyStatus, 5000);
      }
    };

    checkReadyStatus();
  };

  const resetInactivityTimer = () => {
    if (isCartEmpty(productsInCart)) {
      if (inactivityTimeout.current) {
        clearTimeout(inactivityTimeout.current);
        inactivityTimeout.current = null;
      }
      return; // Stop if the cart is empty
    }

    if (inactivityTimeout.current) {
      clearTimeout(inactivityTimeout.current);
    }

    inactivityTimeout.current = setTimeout(() => {
      showInactivityModal();
    }, 10 * 60 * 1000); // 10 minutes
  };

  // Show inactivity modal
  const showInactivityModal = () => {
    setOpenInactivityModal(true);

    // Start decision timer
    decisionTimeout.current = setTimeout(() => {
      clearCart();
    }, 10 * 1000); // 10 seconds
  };

  // Clear cart
  const clearCart = () => {
    setProductsInCart([]);
    setOpenInactivityModal(false);
    resetInactivityTimer(); // Restart inactivity detection
  };

  // User wants to continue
  const continueShopping = () => {
    setOpenInactivityModal(false);

    // Clear decision timer
    if (decisionTimeout.current) {
      clearTimeout(decisionTimeout.current);
    }

    resetInactivityTimer();
  };

  // Effect to track inactivity
  useEffect(() => {
    const handleActivity = () => resetInactivityTimer();

    // Add event listeners for user activity
    window.addEventListener("mousemove", handleActivity);
    window.addEventListener("keypress", handleActivity);

    // Start the inactivity timer if the cart is not empty
    resetInactivityTimer();

    // Cleanup event listeners and timers on unmount
    return () => {
      window.removeEventListener("mousemove", handleActivity);
      window.removeEventListener("keypress", handleActivity);

      if (inactivityTimeout.current) {
        clearTimeout(inactivityTimeout.current);
      }
      if (decisionTimeout.current) {
        clearTimeout(decisionTimeout.current);
      }
    };
  }, [productsInCart]); // Depend on `productsInCart` to react to cart changes

  const enableCartButton = () => {
    if (!isCartEmpty(productsInCart)) {
      return (
        <Button
          variant="contained"
          color="success"
          onClick={handleOrderModalOpen}
        >
          <ShoppingBasketIcon sx={{ mr: 2 }} />
          {t("cartbtn.text")}
        </Button>
      );
    }
    return (
      <Button variant="contained" color="success" disabled>
        <ShoppingBasketIcon sx={{ mr: 2 }} />
        {t("cartbtn.text")}
      </Button>
    );
  };

  const handleRecievePayment = async () => {
    const lastOrderId = getLastOrderId(orders);
    const newOrderId = generateNewOrderId(lastOrderId);

    // Aggregate products by name and quantity
    const uniqueProducts = productsInCart.reduce((acc, product) => {
      const existingProduct = acc.find((p) => p.name === product.name);
      if (existingProduct) {
        existingProduct.quantity += 1;
      } else {
        acc.push({ name: product.name, quantity: 1 });
      }
      return acc;
    }, [] as { name: string; quantity: number }[]);

    const getLang = () => {
      const cancelBtnText = t("order.cancelbtn");
      if (cancelBtnText === "Til Betaling") return "dk";
      if (cancelBtnText === "Zur Kasse Gehen") return "de";
      if (cancelBtnText === "Place Order") return "en";
      return "en"; // Default to English if no match
    };
    // Prepare payload
    const payload = {
      products: uniqueProducts,
      total: total * 100,
      lang: getLang(),
    };

    // Close the Email Modal and Open the Loading Modal
    setOpenLoadingModal(true);

    try {
      const response = await fetch("http://127.0.0.1:8004/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error("Failed to process the order");
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      // Update Orders and Clear Cart
      setOrders([
        ...orders,
        ...uniqueProducts.map((order) => ({
          ...order,
          total: total,
        })),
      ]);

      // Close the Loading Modal on Success
      setRecievedPayment(true);

      setTimeout(() => {
        setOpenLoadingModal(false);
        setRecievedPayment(null);
        setOpenEmailModal(true);
      }, 3000); // 2 seconds
    } catch (error) {
      console.error("Failed to send order:", error);

      // Close the Loading Modal on Failure
      setRecievedPayment(false);

      setTimeout(() => {
        setOpenLoadingModal(false);
        setRecievedPayment(null);
      }, 2000); // 2 seconds

      // Optionally, show an error notification or modal here
    }
  };

  interface OrderForEmail {
    id: string;
    products: { name: string; quantity: number; price: number }[];
    total: number;
    date: string;
  }

  const generateReceiptHtml = (newOrderForEmail: OrderForEmail) => {
    const { id, products, total, date } = newOrderForEmail;

    const productRows = products
      .map(
        (product) => `
          <tr style="border-bottom: 1px solid #ccc; padding: 10px;">
            <td style="padding: 10px; text-align: left;">${product.name}</td>
            <td style="padding: 10px; text-align: center;">${
              product.quantity
            }</td>
            <td style="padding: 10px; text-align: right;">${product.price.toFixed(
              2
            )} KR</td>
            <td style="padding: 10px; text-align: right;">${(
              product.quantity * product.price
            ).toFixed(2)} KR</td>
          </tr>
        `
      )
      .join("");

    return `
      <html>
        <body style="font-family: 'Roboto', sans-serif; margin: 0; padding: 0; background-color: #f9f9f9;">
          <div style="max-width: 600px; margin: 20px auto; padding: 20px; background-color: #fff; border-radius: 8px; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);">
          <div style="display: flex; justify-content: space-between; align-items: center;">  
          
          <h1 style="text-align: center; color: #3f51b5; margin-bottom: 20px;">${t(
            "order.kvitteringHead"
          )}</h1>
          <img src="https://funart.dk/wp-content/uploads/2024/12/cropped-fun-art-logo.png" alt="RubienTech Logo" style="width: 100px; height: auto; filter: invert(100%)" />
            </div>
            <p><strong>ID:</strong> ${id}</p>
            <p><strong>${t("order.date")}:</strong> ${date}</p>
            <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
              <thead>
                <tr style="background-color: #3f51b5; color: #fff;">
                  <th style="padding: 10px; text-align: left;">Product</th>
                  <th style="padding: 10px; text-align: center;">Quantity</th>
                  <th style="padding: 10px; text-align: right;">Price</th>
                  <th style="padding: 10px; text-align: right;">Total</th>
                </tr>
              </thead>
              <tbody>
                ${productRows}
              </tbody>
              <tfoot>
                <tr style="font-weight: bold; border-top: 2px solid #ccc;">
                  <td colspan="3" style="text-align: right; padding: 10px;">Total:</td>
                  <td style="text-align: right; padding: 10px; color: #3f51b5;">${total.toFixed(
                    2
                  )} KR</td>
                </tr>
              </tfoot>
            </table>
            <p style="margin-top: 20px; text-align: center; color: #555;">
              Thank you for your purchase!<br />
              If you have any questions, feel free to contact us.
            </p>
             <p style="margin-top: 16px; text-align: center; color: #555">
              Powered by RubienTech
            </p>
            <footer style="margin-top: 20px; text-align: center; font-size: 0.8em; color: #888;">
              &copy; ${new Date().getFullYear()} RubienTech. All rights reserved.
            </footer>
          </div>
        </body>
      </html>
    `;
  };

  const handleEmailSubmit = async () => {
    if (!/\S+@\S+\.\S+/.test(email)) {
      setEmailError(true);
      return;
    }

    setEmailError(false);
    const lastOrderId = getLastOrderId(orders);
    const newOrderId = generateNewOrderId(lastOrderId);

    const uniqueProducts = productsInCart.reduce((acc, product) => {
      const existingProduct = acc.find((p) => p.name === product.name);
      if (existingProduct) {
        existingProduct.quantity += 1;
      } else {
        acc.push({ name: product.name, quantity: 1, price: product.price });
      }
      return acc;
    }, [] as { name: string; quantity: number; price: number }[]);
    const newOrderForEmail = {
      id: newOrderId,
      products: uniqueProducts,
      total: total,
      email,
      date: new Date().toLocaleString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
      isCompleted: true,
    };

    try {
      await sendEmail({
        to: email,
        subject: "Your Order Receipt",
        html: generateReceiptHtml(newOrderForEmail),
      });

      console.log(
        "Email sent successfully",
        generateReceiptHtml(newOrderForEmail)
      );
      setProductsInCart([]);
      setEmail("");

      setOpenEmailModal(false);
      setOpenReadyToPourModal(true);
    } catch (error) {
      console.error("Failed to send email:", error);
      // Optionally, show an error notification or modal here
      setProductsInCart([]);
      setEmail("");
      setOpenEmailModal(false);
    }
  };

  const handleKeyboardInput = (input: string) => {
    setKeyboardInput(input);
    setEmail(input);
  };

  return (
    <Paper className={classes["container-total"]} elevation={5} square>
      <Typography
        variant="body1"
        component="h2"
        className={classes["total-font"]}
        sx={{ fontSize: 20 }}
      >
        Total: {ccyFormat(total)}KR
      </Typography>
      {enableCartButton()}
      {/* Order Confirmation Modal */}
      <Modal
        open={openOrderModal}
        onClose={handleOrderModalClose}
        aria-labelledby="order-modal-title"
        aria-describedby="order-modal-description"
      >
        <Box className={classes["modal-style"]}>
          <Typography id="order-modal-title" variant="h6" component="h2">
            <strong>{t("order.confirmtext")}</strong>
          </Typography>
          <br />
          <Box sx={{ display: "flex", gap: 2 }}>
            <Button
              size="small"
              color="error"
              variant="contained"
              onClick={handleOrderModalClose}
              sx={{ fontSize: 20, fontWeight: "bold" }}
            >
              {t("order.cancelbtn")}
            </Button>
            <Button
              size="small"
              color="success"
              variant="contained"
              onClick={() => {
                setOpenOrderModal(false);
                setOpenLoadingModal(true);
                handleRecievePayment();
              }}
              sx={{ fontSize: 20, fontWeight: "bold" }}
            >
              {t("order.confirmbtn")}
            </Button>
          </Box>
        </Box>
      </Modal>
      {/* Email Input Modal */}
      <Modal
        open={openEmailModal}
        onClose={handleEmailModalClose}
        aria-labelledby="email-modal-title"
        aria-describedby="email-modal-description"
        disableAutoFocus
      >
        <Box className={classes["modal-style"]}>
          <Typography id="email-modal-title" variant="h6" component="h2">
            <strong>{t("order.emailreceipt")}</strong>
          </Typography>
          <TextField
            fullWidth
            variant="outlined"
            label="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={emailError}
            helperText={emailError ? "Please enter a valid email address" : ""}
            sx={{ mt: 2 }}
          />
          <Box sx={{ display: "flex", gap: 4, mt: 2 }}>
            <Button
              size="small"
              color="error"
              variant="outlined"
              onClick={handleEmailModalClose}
            >
              {t("order.emailbtn-cancel")}
            </Button>
            <Button
              size="small"
              color="success"
              variant="outlined"
              onClick={handleEmailSubmit}
            >
              {t("order.emailbtn-ok")}
            </Button>
          </Box>
        </Box>
      </Modal>
      <Modal
        open={openLoadingModal}
        aria-labelledby="modal-modal-title"
        aria-describedby="modal-modal-description"
      >
        <Box className={classes["modal-style"]}>
          <Typography
            id="modal-modal-title"
            variant="h6"
            component="h2"
            sx={{ fontWeight: "bold", fontSize: 20 }}
          >
            {t("order.pendingpayment")}
          </Typography>
          {recievedPayment === null ? (
            <img src={paymentGif} alt="" style={{ width: "340px" }} />
          ) : recievedPayment ? (
            <CheckCircleIcon sx={{ fontSize: 150, color: "green" }} />
          ) : (
            <CancelIcon sx={{ fontSize: 150, color: "red" }} />
          )}
        </Box>
      </Modal>
      {/* Inactivity Modal */}
      <Modal
        open={openInactivityModal}
        aria-labelledby="inactivity-modal-title"
        aria-describedby="inactivity-modal-description"
      >
        <Box className={classes["modal-style"]}>
          <Typography id="inactivity-modal-title" variant="h6" component="h2">
            {t("inactivity.message")}
          </Typography>
          <Typography variant="body2">{t("inactivity.prompt")}</Typography>
          <Box sx={{ display: "flex", gap: 4, mt: 2 }}>
            <Button
              size="small"
              color="error"
              variant="outlined"
              onClick={clearCart}
            >
              {t("inactivity.clearcart")}
            </Button>
            <Button
              size="small"
              color="success"
              variant="outlined"
              onClick={continueShopping}
            >
              {t("inactivity.continue")}
            </Button>
          </Box>
        </Box>
      </Modal>
      <Modal
        open={openReadyToPourModal}
        aria-labelledby="inactivity-modal-title"
        aria-describedby="inactivity-modal-description"
      >
        <Box className={classes["modal-style"]}>
          <Typography id="inactivity-modal-title" variant="h6" component="h2">
            {t("order.pourmessage")}
          </Typography>
          <Hourglass
            visible={true}
            height="80"
            width="80"
            ariaLabel="hourglass-loading"
            wrapperStyle={{}}
            wrapperClass=""
            colors={["#306cce", "#72a1ed"]}
          />
        </Box>
      </Modal>

      {/* Onscreen Keyboard */}
      {openEmailModal && (
        <Box
          sx={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: "#fff",
            boxShadow: "0 -2px 10px rgba(0, 0, 0, 0.1)",
            zIndex: 1400, // Higher than the modal backdrop (default 1300)
          }}
        >
          <Keyboard onChange={handleKeyboardInput} input={keyboardInput} />
        </Box>
      )}
    </Paper>
  );
};
